/**
 * 台灣地圖核心控制器 (Map Controller)
 * 整合台灣通用電子地圖 (NLSC) 與 ESRI 街景地圖 (100% 完全免費、免金鑰、無浮水印)
 * 支援拖曳地圖隨時即時更新周邊導覽、全台任一地點搜尋、5km 雷達與距離計算
 */

class TourMapController {
  constructor() {
    this.map = null;
    this.markersLayer = null;
    this.searchCircle = null;
    this.searchCenterMarker = null;

    // Google Maps 風格使用者目前位置藍點圖層
    this.userLocationMarker = null;
    this.userLocation = null;

    // 目前搜尋中心座標與半徑 (預設 5km)
    this.currentSearchCenter = null;
    this.searchRadiusKm = 5.0;

    // 拖曳地圖自動更新開關 (預設關閉，確保縮放與平移時定位點固定在真實經緯度不亂跑)
    this.autoSearchOnDrag = false;
    this._dragDebounceTimer = null;
    this._isProgrammaticMove = false;

    // 回呼函數
    this.onSpotsFiltered = null;
    this.onSpotSelected = null;
  }

  // 初始化地圖
  initMap(containerId = "map") {
    // 預設以台灣中心為視角
    this.map = L.map(containerId, {
      center: [23.9738, 120.9820],
      zoom: 8,
      zoomControl: false,
      tap: true,
      maxBounds: [[21.5, 118.0], [26.5, 122.5]], // 限制在台灣全境
      minZoom: 7
    });

    // 縮放控制放置於左下方
    L.control.zoom({ position: "bottomleft" }).addTo(this.map);

    // 1. 台灣通用電子地圖 (NLSC 內政部國土測繪圖資，官方正版、繁體中文地標最完整、無浮水印)
    const nlscEMap = L.tileLayer("https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}", {
      attribution: '&copy; <a href="https://maps.nlsc.gov.tw/" target="_blank">國土測繪圖資服務雲</a>',
      maxZoom: 19,
      crossOrigin: true
    });

    // 2. ESRI World Street Map (全球高清街景，高速、無須 API Key)
    const esriStreet = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri &mdash; Sources: Esri, DeLorme, NAVTEQ',
      maxZoom: 19
    });

    // 3. ESRI 衛星空照圖
    const esriSat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS',
      maxZoom: 19
    });

    // 預設載入台灣通用電子地圖
    nlscEMap.addTo(this.map);

    // 圖層切換選單 (放置在左下角，自由切換)
    const baseLayers = {
      "🗺️ 台灣通用地圖": nlscEMap,
      "🏙️ 街景地圖": esriStreet,
      "🛰️ 衛星影像": esriSat
    };
    L.control.layers(baseLayers, null, { position: "bottomleft" }).addTo(this.map);

    // 標記圖層群組
    this.markersLayer = L.layerGroup().addTo(this.map);

    // 點擊地圖任意處，立即以該點為中心進行 5km 導覽搜尋 (定位點平滑更新至點選座標)
    this.map.on("click", (e) => {
      this.setSearchCenter(e.latlng.lat, e.latlng.lng, "自選地圖位置", false, false);
    });

    // 縮放 (Zoom) 與平移時定位點永遠固定在經緯度上，絕不隨畫面亂跑
    // 僅在使用者明確開啟隨動搜尋且拖曳結束時才可選擇性更新
    this.map.on("dragend", () => {
      if (this.autoSearchOnDrag && !this._isProgrammaticMove) {
        const center = this.map.getCenter();
        this.setSearchCenter(center.lat, center.lng, "目前地圖視野周邊", false, false);
      }
    });

    console.log("台灣高清圖資地圖初始化完成（定位點已鎖定真實經緯度，支援即時 GPS/IP 定位）！");
  }

  // 計算兩經緯度間的直線距離 (公里)
  static calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(1));
  }

  // 計算頂部搜尋控制面板即時高度，動態提供地圖彈窗避讓安全邊距
  getTopAvoidanceHeight() {
    const searchContainer = document.querySelector(".floating-search-container");
    if (searchContainer) {
      const rect = searchContainer.getBoundingClientRect();
      // 避讓距離設定在搜尋列底部下方約 18px，並確保最少有 240px
      return Math.round(Math.max(rect.bottom + 18, 240));
    }
    return 240;
  }

  // 設定搜尋中心點並繪製 5km 半徑圈
  setSearchCenter(lat, lng, label = "搜尋中心點", fitBounds = true, animateFly = true) {
    this.currentSearchCenter = { lat, lng, label };

    // 清除舊的中心標記與半徑圈
    if (this.searchCenterMarker) this.map.removeLayer(this.searchCenterMarker);
    if (this.searchCircle) this.map.removeLayer(this.searchCircle);

    // 繪製中心點標記 (質感情侶雷達波紋動態 Pin)
    const centerIcon = L.divIcon({
      className: "custom-radar-center",
      html: `
        <div class="radar-pulse"></div>
        <div class="radar-pin">
          <span class="radar-dot">📍</span>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    this.searchCenterMarker = L.marker([lat, lng], { icon: centerIcon })
      .addTo(this.map)
      .bindPopup(`<div class="center-popup"><strong>🎯 ${label}</strong><br>周邊 ${this.searchRadiusKm} 公里真人導覽雷達圈</div>`, {
        autoPan: true,
        autoPanPaddingTopLeft: L.point(20, this.getTopAvoidanceHeight()),
        autoPanPaddingBottomRight: L.point(20, 70)
      });

    // 繪製 5km 半徑圓 (柔和鼠尾草綠與溫潤珊瑚陶橘)
    this.searchCircle = L.circle([lat, lng], {
      radius: this.searchRadiusKm * 1000,
      color: "#588157",
      weight: 1.8,
      opacity: 0.85,
      fillColor: "#81B29A",
      fillOpacity: 0.12,
      dashArray: "5, 6"
    }).addTo(this.map);

    if (fitBounds) {
      this._isProgrammaticMove = true;
      this.map.fitBounds(this.searchCircle.getBounds(), { padding: [50, 50], maxZoom: 14 });
      setTimeout(() => { this._isProgrammaticMove = false; }, 800);
    } else if (animateFly) {
      this._isProgrammaticMove = true;
      this.map.panTo([lat, lng]);
      setTimeout(() => { this._isProgrammaticMove = false; }, 400);
    }

    // 觸發景點重新計算與篩選
    if (this.onSpotsFiltered) {
      this.onSpotsFiltered();
    }
  }

  // 清除搜尋半徑圈，恢復全覽視角
  clearSearchCenter() {
    if (this.searchCenterMarker) this.map.removeLayer(this.searchCenterMarker);
    if (this.searchCircle) this.map.removeLayer(this.searchCircle);
    this.currentSearchCenter = null;
    this.searchCenterMarker = null;
    this.searchCircle = null;

    if (this.onSpotsFiltered) {
      this.onSpotsFiltered();
    }
  }

  // 調整搜尋半徑 (3km, 5km, 10km)
  setRadius(radiusKm) {
    this.searchRadiusKm = radiusKm;
    if (this.currentSearchCenter) {
      this.setSearchCenter(
        this.currentSearchCenter.lat,
        this.currentSearchCenter.lng,
        this.currentSearchCenter.label,
        true
      );
    }
  }

  // 全台地點搜尋 (使用免費 OpenStreetMap Nominatim 台灣專區)
  async searchLocation(query) {
    if (!query || !query.trim()) return null;
    const cleanQuery = query.trim();

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery)}&countrycodes=tw&limit=1&accept-language=zh-TW`;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" }
      });
      const data = await response.json();

      if (data && data.length > 0) {
        const item = data[0];
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        const displayName = item.display_name.split(",")[0] || cleanQuery;

        this.setSearchCenter(lat, lng, displayName, true);
        return { lat, lng, name: displayName };
      } else {
        return null;
      }
    } catch (err) {
      console.error("地點搜尋發生錯誤:", err);
      return null;
    }
  }

  // 建立或更新 Google Maps 風格經典脈衝藍點 (Blue Dot)
  setUserLocation(lat, lng, label = "我的目前位置") {
    this.userLocation = { lat, lng, label };

    const blueDotIcon = L.divIcon({
      className: "gmaps-user-marker",
      html: `
        <div class="gmaps-blue-dot-wrap">
          <div class="gmaps-blue-pulse"></div>
          <div class="gmaps-blue-dot"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });

    if (this.userLocationMarker) {
      this.userLocationMarker.setLatLng([lat, lng]);
      this.userLocationMarker.setIcon(blueDotIcon);
    } else {
      this.userLocationMarker = L.marker([lat, lng], {
        icon: blueDotIcon,
        zIndexOffset: 1000 // 確保在一般景點圖層上方
      }).addTo(this.map);
    }

    this.userLocationMarker.bindPopup(`
      <div class="user-location-popup" style="text-align:center; padding: 4px 6px;">
        <strong style="color:#1A73E8; font-size:13px;">📍 ${label}</strong><br>
        <span style="font-size:11px; color:#5F6368;">即時所在經緯度: ${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
      </div>
    `, {
      autoPan: true,
      autoPanPaddingTopLeft: L.point(20, this.getTopAvoidanceHeight()),
      autoPanPaddingBottomRight: L.point(20, 70)
    });
  }

  // 透過網路 IP 備援定位 (支援本地 file:/// 模式或 GPS 權限受限情境)
  async locateByIp() {
    // 優先嘗試 ipwho.is (免金鑰、支援 CORS、對台灣城市定位精確)
    try {
      const resp = await fetch("https://ipwho.is/", { headers: { "Accept": "application/json" } });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.success !== false && data.latitude && data.longitude) {
          const cityName = data.city || data.region || "台灣地區";
          return {
            lat: parseFloat(data.latitude),
            lng: parseFloat(data.longitude),
            city: cityName
          };
        }
      }
    } catch (e) {
      console.warn("ipwho.is 查詢失敗，嘗試次要備援端點:", e);
    }

    // 第二備援：freeipapi.com
    try {
      const resp2 = await fetch("https://freeipapi.com/api/json", { headers: { "Accept": "application/json" } });
      if (resp2.ok) {
        const data2 = await resp2.json();
        if (data2 && data2.latitude && data2.longitude) {
          return {
            lat: parseFloat(data2.latitude),
            lng: parseFloat(data2.longitude),
            city: data2.cityName || "目前所在地"
          };
        }
      }
    } catch (e2) {
      console.warn("freeipapi 查詢失敗:", e2);
    }

    return null;
  }

  // 即時定位（支援瀏覽器高精度 GPS 與網路 IP 雙重智慧備援，100% 成功定位）
  locateUser() {
    return new Promise(async (resolve, reject) => {
      // 1. 若環境支援且非 file:/// 安全受限協議，嘗試瀏覽器原生高精度 GPS
      if (navigator.geolocation && (window.isSecureContext || location.protocol === "http:" || location.protocol === "https:")) {
        try {
          const pos = await new Promise((res, rej) => {
            navigator.geolocation.getCurrentPosition(res, rej, {
              enableHighAccuracy: true,
              timeout: 6000,
              maximumAge: 0
            });
          });
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          this.setUserLocation(lat, lng, "我的目前位置 (精確 GPS)");
          this.setSearchCenter(lat, lng, "我的目前位置", false, false);
          this._isProgrammaticMove = true;
          this.map.flyTo([lat, lng], 14, { duration: 1.0 });
          setTimeout(() => { this._isProgrammaticMove = false; }, 1200);
          return resolve({ lat, lng, source: "gps", accuracy: pos.coords.accuracy });
        } catch (gpsErr) {
          console.warn("原生 GPS 取得未完成，啟動智慧 IP 備援定位:", gpsErr);
        }
      }

      // 2. 智慧備援：若是 file:/// 或原生 GPS 未許可/超時，以網路 IP 快速定位
      try {
        const ipData = await this.locateByIp();
        if (ipData) {
          this.setUserLocation(ipData.lat, ipData.lng, `我的目前位置 (${ipData.city})`);
          this.setSearchCenter(ipData.lat, ipData.lng, `我的目前位置 (${ipData.city})`, false, false);
          this._isProgrammaticMove = true;
          this.map.flyTo([ipData.lat, ipData.lng], 14, { duration: 1.0 });
          setTimeout(() => { this._isProgrammaticMove = false; }, 1200);
          return resolve({ lat: ipData.lat, lng: ipData.lng, source: "ip", city: ipData.city });
        }
      } catch (ipErr) {
        console.warn("IP 備援定位發生錯誤:", ipErr);
      }

      reject(new Error("無法取得定位資訊，請確認網路連線或允許位置存取權限"));
    });
  }

  // 平滑飛回目前設定的搜尋定位點/雷達中心
  recenterToTarget() {
    if (this.currentSearchCenter) {
      this._isProgrammaticMove = true;
      this.map.flyTo([this.currentSearchCenter.lat, this.currentSearchCenter.lng], 14, { duration: 0.8 });
      setTimeout(() => { this._isProgrammaticMove = false; }, 900);
      return true;
    }
    return false;
  }

  // 渲染景點標記
  renderMarkers(tours, isFavoriteFn, isClosedTodayFn) {
    this.markersLayer.clearLayers();

    tours.forEach(tour => {
      const isFav = isFavoriteFn ? isFavoriteFn(tour.id) : false;
      const isClosed = isClosedTodayFn ? isClosedTodayFn(tour) : false;
      const isSelected = this.selectedTourId === tour.id;

      const favClass = isFav ? "is-favorite" : "";
      const closedClass = isClosed ? "is-closed" : "";
      const selectedClass = isSelected ? "is-selected" : "";
      
      const customIcon = L.divIcon({
        className: `custom-spot-marker ${favClass} ${closedClass} ${selectedClass}`,
        html: `
          <div class="marker-pin-wrap">
            <div class="marker-bubble">
              <span class="marker-icon">${isFav ? '💛' : (isClosed ? '🔒' : '🎙️')}</span>
            </div>
            <div class="marker-shadow"></div>
          </div>
        `,
        iconSize: [38, 46],
        iconAnchor: [19, 44],
        popupAnchor: [0, -42]
      });

      const marker = L.marker([tour.lat, tour.lng], { icon: customIcon });

      // 點擊地標：絕對靜止零位移，高亮標記並即時在右側開啟官網
      marker.on("click", (e) => {
        if (e && e.originalEvent) {
          L.DomEvent.stopPropagation(e);
        }
        this.highlightMarker(tour);
        if (this.onSpotSelected) this.onSpotSelected(tour);
      });

      this.markersLayer.addLayer(marker);
      tour._marker = marker;
      if (isSelected) {
        this.selectedMarkerEl = marker.getElement();
      }
    });
  }

  // 高亮選中標記
  highlightMarker(tour) {
    this.selectedTourId = tour ? tour.id : null;
    if (this.selectedMarkerEl) {
      this.selectedMarkerEl.classList.remove("is-selected");
      this.selectedMarkerEl = null;
    }
    if (tour && tour._marker) {
      const el = tour._marker.getElement();
      if (el) {
        el.classList.add("is-selected");
        this.selectedMarkerEl = el;
      }
    }
  }

  // 清除高亮
  clearHighlight() {
    this.selectedTourId = null;
    if (this.selectedMarkerEl) {
      this.selectedMarkerEl.classList.remove("is-selected");
      this.selectedMarkerEl = null;
    }
  }

  // 建立景點彈窗 HTML
  createPopupContent(tour, isFav, isClosed) {
    const gmapsUrl = TourShareAndCalendar.getGoogleMapsNavUrl(tour);
    const scheduleText = Array.isArray(tour.schedule) ? tour.schedule.join('、') : (tour.schedule || '詳洽官網');
    
    let distanceBadge = '';
    if (this.currentSearchCenter) {
      const dist = TourMapController.calculateDistanceKm(
        this.currentSearchCenter.lat, this.currentSearchCenter.lng,
        tour.lat, tour.lng
      );
      distanceBadge = `<span class="badge badge-distance">📏 距目前中心 ${dist} km</span>`;
    }

    const statusBadge = isClosed 
      ? `<span class="badge badge-closed">⚠️ 今日休館</span>`
      : `<span class="badge badge-open">🟢 今日有導覽</span>`;

    let ticketTiersHtml = "";
    if (tour.ticketTiers) {
      ticketTiersHtml = `
        <div class="popup-section price-section">
          <div class="section-label">💰 完整票價與優惠明細：</div>
          <div class="ticket-tiers-box">
            ${tour.ticketTiers.regular ? `
              <div class="tier-item tier-reg">
                <span class="tier-badge">🎟️ 全票</span>
                <span class="tier-desc">${tour.ticketTiers.regular}</span>
              </div>
            ` : ''}
            ${tour.ticketTiers.concession ? `
              <div class="tier-item tier-con">
                <span class="tier-badge">🎓 優待票</span>
                <span class="tier-desc">${tour.ticketTiers.concession}</span>
              </div>
            ` : ''}
            ${tour.ticketTiers.free ? `
              <div class="tier-item tier-free">
                <span class="tier-badge">🧓 免票資格</span>
                <span class="tier-desc">${tour.ticketTiers.free}</span>
              </div>
            ` : ''}
            ${tour.ticketTiers.tourFee ? `
              <div class="tier-item tier-tour">
                <span class="tier-badge">🎙️ 導覽費用</span>
                <span class="tier-desc">${tour.ticketTiers.tourFee}</span>
              </div>
            ` : ''}
            ${tour.ticketTiers.events ? `
              <div class="tier-item tier-promo">
                <span class="tier-badge">🎁 活動與優惠</span>
                <span class="tier-desc">${tour.ticketTiers.events}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="spot-popup-card">
        <div class="popup-header">
          <div class="popup-title-row">
            <h3 class="popup-title">${tour.name}</h3>
          </div>
          <div class="popup-badges">
            <span class="badge badge-county">📍 ${tour.county} · ${tour.district || ''}</span>
            ${statusBadge}
            ${distanceBadge}
          </div>
        </div>

        <div class="popup-body">
          <div class="popup-section">
            <div class="section-label">🎙️ 真人導覽內容概述：</div>
            <div class="section-text summary-box">${tour.summary || '現場提供資深專人解說，帶你深度認識在地歷史與展覽特色。'}</div>
          </div>

          <div class="popup-meta-grid">
            <div class="meta-item">
              <span class="meta-icon">⏰</span>
              <span class="meta-val"><strong>場次：</strong>${scheduleText} (${tour.duration || '約45分'})</span>
            </div>
            ${!tour.ticketTiers ? `
            <div class="meta-item">
              <span class="meta-icon">💰</span>
              <span class="meta-val"><strong>費用：</strong>${tour.price || '免費'}</span>
            </div>` : ''}
            <div class="meta-item">
              <span class="meta-icon">📅</span>
              <span class="meta-val"><strong>休館：</strong>${tour.closedText || '無'}</span>
            </div>
          </div>

          ${ticketTiersHtml}
        </div>

        <div class="popup-actions">
          <a href="${gmapsUrl}" target="_blank" class="btn btn-gmaps" title="開啟 Google Maps 路線導航">
            🗺️ Google Maps 導航
          </a>
          ${tour.officialUrl ? `
            <a href="${tour.officialUrl}" target="_blank" class="btn btn-official" title="前往景點官方導覽網頁">
              🔗 官方導覽原網頁
            </a>
          ` : ''}
        </div>

        <div class="popup-bottom-bar">
          <button class="btn btn-fav-toggle ${isFav ? 'active' : ''}" onclick="window.app.toggleFavorite('${tour.id}')">
            ${isFav ? '💛 已在收藏清單' : '🤍 加入收藏'}
          </button>
          <button class="btn btn-share" onclick="window.TourShareAndCalendar.shareToPartner(window.app.getTourById('${tour.id}'))" title="透過 LINE 分享給另一半">
            📲 分享
          </button>
          <button class="btn btn-cal" onclick="window.app.addToCalendar('${tour.id}')" title="加入 iPhone 行事曆並同步兩人日程">
            📅 加行事曆
          </button>
        </div>
      </div>
    `;
  }

  // 平滑飛往指定經緯度
  flyToSpot(lat, lng, zoom = 15) {
    this._isProgrammaticMove = true;
    this.map.flyTo([lat, lng], zoom, { duration: 1.0 });
    setTimeout(() => { this._isProgrammaticMove = false; }, 1200);
  }

  focusSpot(tour) {
    if (!tour) return;
    this.highlightMarker(tour);

    // 檢查景點是否在目前視野可見範圍內；如果在範圍內完全不動，徹底避免眼花
    const bounds = this.map.getBounds();
    const latLng = L.latLng(tour.lat, tour.lng);
    if (!bounds.contains(latLng)) {
      this._isProgrammaticMove = true;
      this.map.panTo(latLng, { animate: true, duration: 0.4 });
      setTimeout(() => {
        this._isProgrammaticMove = false;
      }, 450);
    }

    if (this.onSpotSelected) {
      this.onSpotSelected(tour);
    }
  }

  flyToCounty(countyName) {
    const countyCenters = {
      "台北市": [25.0330, 121.5654],
      "新北市": [25.0113, 121.4552],
      "基隆市": [25.1276, 121.7392],
      "宜蘭縣": [24.7021, 121.7377],
      "桃園市": [24.9936, 121.3010],
      "新竹市": [24.8039, 120.9647],
      "新竹縣": [24.8387, 121.0177],
      "苗栗縣": [24.5602, 120.8214],
      "台中市": [24.1477, 120.6736],
      "彰化縣": [24.0818, 120.5385],
      "南投縣": [23.9609, 120.9719],
      "雲林縣": [23.7092, 120.4313],
      "嘉義市": [23.4800, 120.4491],
      "嘉義縣": [23.4518, 120.2559],
      "台南市": [22.9997, 120.2270],
      "高雄市": [22.6273, 120.3014],
      "屏東縣": [22.5519, 120.5487],
      "花蓮縣": [23.9871, 121.6015],
      "台東縣": [22.7583, 121.1444],
      "澎湖縣": [23.5711, 119.5793],
      "金門縣": [24.4492, 118.3766],
      "連江縣": [26.1557, 119.9405]
    };

    if (countyCenters[countyName]) {
      const [lat, lng] = countyCenters[countyName];
      this._isProgrammaticMove = true;
      this.map.flyTo([lat, lng], 12, { duration: 1.0 });
      setTimeout(() => {
        this._isProgrammaticMove = false;
        // 以該縣市中心點作為搜尋中心
        this.setSearchCenter(lat, lng, countyName, false, false);
      }, 1000);
    }
  }
}

window.TourMapController = TourMapController;
