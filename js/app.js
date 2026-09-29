/**
 * 台灣真人導覽地圖 - 主應用程式 (App Controller)
 * 專為情侶打造：溫馨風格、全台5km雷達、拖曳隨動即時更新、今日休館比對、場次倒數、右側縣市分類收藏抽屜、兩人雲端即時同步
 */

class TourApp {
  constructor() {
    this.mapCtrl = new TourMapController();
    this.allTours = [];
    this.filteredTours = [];
    
    // 篩選器狀態
    this.selectedCounty = "全部縣市";
    this.selectedTimeSlot = "all"; // all, upcoming, morning, afternoon, free, open-today
    this.keyword = "";
    
    // UI 元件參照
    this.dom = {};
  }

  init() {
    this.cacheDom();
    this.initMap();
    this.initData();
    this.bindEvents();
    this.initSyncListeners();
    this.renderCountyFilterOptions();
    this.updateRoomCodeDisplay();
    this.checkIPhonePwaPrompt();
    this.registerServiceWorker();

    // 每分鐘更新一次今日導覽倒數時段狀態
    setInterval(() => {
      this.applyFilters();
    }, 60000);

    console.log("台灣真人導覽地圖 App 已就緒！");
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[TourApp] PWA Service Worker 註冊成功，範圍:', reg.scope);
        })
        .catch((err) => {
          console.warn('[TourApp] Service Worker 註冊略過:', err);
        });
    }
  }

  cacheDom() {
    this.dom = {
      searchInput: document.getElementById("search-input"),
      btnSearch: document.getElementById("btn-search"),
      btnGps: document.getElementById("btn-gps"),
      countySelect: document.getElementById("county-select"),
      timeFilterSelect: document.getElementById("time-filter-select"),
      radiusGroup: document.getElementById("radius-group"),
      radarInfoBar: document.getElementById("radar-info-bar"),
      radarText: document.getElementById("radar-text"),
      btnClearRadar: document.getElementById("btn-clear-radar"),
      btnRecenter: document.getElementById("btn-recenter"),
      btnFloatingGps: document.getElementById("btn-floating-gps"),
      btnRoomTrigger: document.getElementById("btn-room-trigger"),

      // 快捷膠囊
      btnQuickToday: document.getElementById("btn-quick-today"),
      btnQuickFree: document.getElementById("btn-quick-free"),
      
      // 抽屜與按鈕
      btnOpenFavs: document.getElementById("btn-open-favs"),
      favDrawer: document.getElementById("fav-drawer"),
      favOverlay: document.getElementById("fav-overlay"),
      btnCloseFavs: document.getElementById("btn-close-favs"),
      favCountBadge: document.getElementById("fav-count-badge"),
      favListContainer: document.getElementById("fav-list-container"),

      // 列表與卡片
      spotsCountText: document.getElementById("spots-count-text"),
      spotsListContainer: document.getElementById("spots-list-container"),
      btnToggleList: document.getElementById("btn-toggle-list"),
      spotsSheet: document.getElementById("spots-sheet"),
      sheetHandle: document.getElementById("sheet-handle"),

      // 彈窗
      modalTour: document.getElementById("modal-tour"),
      tourForm: document.getElementById("tour-form"),
      btnOpenAddTour: document.getElementById("btn-open-add-tour"),
      btnCloseTourModal: document.getElementById("btn-close-tour-modal"),

      modalSettings: document.getElementById("modal-settings"),
      btnOpenSettings: document.getElementById("btn-open-settings"),
      btnCloseSettings: document.getElementById("btn-close-settings"),
      inputRoomCode: document.getElementById("input-room-code"),
      btnSaveRoomCode: document.getElementById("btn-save-room-code"),
      currentRoomBadge: document.getElementById("current-room-badge"),
      btnSyncDatabase: document.getElementById("btn-sync-database"),
      dbStatusHint: document.getElementById("db-status-hint"),

      modalSchedule: document.getElementById("modal-schedule"),
      btnOpenSchedule: document.getElementById("btn-open-schedule"),
      btnCloseSchedule: document.getElementById("btn-close-schedule"),
      scheduleListContainer: document.getElementById("schedule-list-container"),

      // Toast 溫馨通知
      toast: document.getElementById("toast")
    };
  }

  initMap() {
    this.mapCtrl.initMap("map");

    // 地圖搜尋中心更動時，重新計算周邊景點並同步定位按鈕狀態
    this.mapCtrl.onSpotsFiltered = () => {
      if (this.dom.btnFloatingGps && this.mapCtrl.userLocation && this.mapCtrl.currentSearchCenter) {
        const isAtUser = Math.abs(this.mapCtrl.currentSearchCenter.lat - this.mapCtrl.userLocation.lat) < 0.0001 &&
                         Math.abs(this.mapCtrl.currentSearchCenter.lng - this.mapCtrl.userLocation.lng) < 0.0001;
        this.dom.btnFloatingGps.classList.toggle("active", isAtUser);
      }
      this.applyFilters();
    };
  }

  // 整合預載資料與自訂資料庫，並支援線上動態同步
  async initData() {
    this.loadToursData(DEFAULT_TOURS_DATA);

    // 嘗試動態獲取 data/tours.json (如果是在 localhost 或有 server 環境下)
    if (window.location.protocol.startsWith("http")) {
      await this.checkForTourUpdates(false);
    }
  }

  loadToursData(baseTours) {
    this.baseTours = baseTours;
    const custom = window.tourSync.getCustomTours();
    const map = new Map();
    baseTours.forEach(t => map.set(t.id, t));
    custom.forEach(t => map.set(t.id, t));

    this.allTours = Array.from(map.values());
    this.applyFilters();
  }

  // 檢查並動態拉取最新資料庫
  async checkForTourUpdates(isUserTriggered = false) {
    if (this.dom.btnSyncDatabase) {
      this.dom.btnSyncDatabase.disabled = true;
      this.dom.btnSyncDatabase.innerText = "⏳ 正在檢查資料庫更新...";
    }

    try {
      const resp = await fetch("data/tours.json?t=" + Date.now());
      if (resp.ok) {
        const json = await resp.json();
        const freshData = Array.isArray(json) ? json : (json.tours || []);
        if (freshData.length > 0) {
          this.loadToursData(freshData);
          if (this.dom.dbStatusHint) {
            this.dom.dbStatusHint.innerHTML = `✅ 資料庫最新狀態：共收錄 ${freshData.length} 筆景點（更新時間：${new Date().toLocaleTimeString()}）`;
          }
          if (isUserTriggered) {
            this.showToast(`🎉 資料庫同步完成！全台共收錄 ${freshData.length} 處真人導覽！`);
          }
        }
      } else {
        if (isUserTriggered) this.showToast(`目前已是最新資料庫版本（共 ${this.allTours.length} 處景點）🌿`);
      }
    } catch (err) {
      console.warn("[TourApp] 動態更新檢查略過:", err);
      if (isUserTriggered) {
        this.showToast(`本機離線模式：已載入目前資料庫（共 ${this.allTours.length} 處景點）🌿`);
      }
    } finally {
      if (this.dom.btnSyncDatabase) {
        this.dom.btnSyncDatabase.disabled = false;
        this.dom.btnSyncDatabase.innerText = "🔄 立即檢查並更新景點資料庫";
      }
    }
  }

  // 監聽雲端即時同步回呼
  initSyncListeners() {
    window.tourSync.onFavoritesChanged((favs) => {
      this.updateFavCountBadge(favs.length);
      this.renderFavoritesDrawer(favs);
      this.renderMapMarkers();
    });

    window.tourSync.onToursChanged((customTours) => {
      const base = this.baseTours || DEFAULT_TOURS_DATA;
      const map = new Map();
      base.forEach(t => map.set(t.id, t));
      customTours.forEach(t => map.set(t.id, t));
      this.allTours = Array.from(map.values());
      this.applyFilters();
    });

    window.tourSync.onScheduleChanged((schedules) => {
      this.renderScheduleModal(schedules);
    });
  }

  bindEvents() {
    // 關鍵字與地點搜尋 (按 Enter 或點擊搜尋)
    this.dom.btnSearch.addEventListener("click", () => this.handleSearch());
    this.dom.searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handleSearch();
    });

    // GPS 當前位置定位 (頂部按鈕與 Google Maps 右下角浮動按鈕)
    if (this.dom.btnGps) {
      this.dom.btnGps.addEventListener("click", () => this.handleGps());
    }
    if (this.dom.btnFloatingGps) {
      this.dom.btnFloatingGps.addEventListener("click", () => this.handleGps());
    }

    // 回到定位點按鈕
    if (this.dom.btnRecenter) {
      this.dom.btnRecenter.addEventListener("click", () => {
        const ok = this.mapCtrl.recenterToTarget();
        if (ok) {
          this.showToast("已將視野平滑移回目前定位點 🎯");
        } else {
          this.showToast("目前尚未設定定位點，請點擊地圖或搜尋地點 🎯");
        }
      });
    }

    // 點擊房間徽章打開同步設定
    if (this.dom.btnRoomTrigger) {
      this.dom.btnRoomTrigger.addEventListener("click", () => this.openSettingsModal());
    }

    // 縣市切換
    this.dom.countySelect.addEventListener("change", (e) => {
      this.selectedCounty = e.target.value;
      if (this.selectedCounty !== "全部縣市") {
        this.mapCtrl.flyToCounty(this.selectedCounty);
      } else {
        this.mapCtrl.clearSearchCenter();
      }
      this.applyFilters();
    });

    // 時段與倒數快篩選單
    this.dom.timeFilterSelect.addEventListener("change", (e) => {
      this.selectedTimeSlot = e.target.value;
      this.updateQuickChipStates();
      this.applyFilters();
    });

    // 快捷膠囊：今日有開
    if (this.dom.btnQuickToday) {
      this.dom.btnQuickToday.addEventListener("click", () => {
        if (this.selectedTimeSlot === "open-today") {
          this.selectedTimeSlot = "all";
          this.dom.timeFilterSelect.value = "all";
        } else {
          this.selectedTimeSlot = "open-today";
          this.dom.timeFilterSelect.value = "open-today";
        }
        this.updateQuickChipStates();
        this.applyFilters();
      });
    }

    // 快捷膠囊：免費導覽
    if (this.dom.btnQuickFree) {
      this.dom.btnQuickFree.addEventListener("click", () => {
        if (this.selectedTimeSlot === "free") {
          this.selectedTimeSlot = "all";
          this.dom.timeFilterSelect.value = "all";
        } else {
          this.selectedTimeSlot = "free";
          this.dom.timeFilterSelect.value = "free";
        }
        this.updateQuickChipStates();
        this.applyFilters();
      });
    }

    // 5km 半徑雷達切換
    if (this.dom.radiusGroup) {
      this.dom.radiusGroup.querySelectorAll(".radius-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          this.dom.radiusGroup.querySelectorAll(".radius-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          const r = parseFloat(btn.dataset.radius);
          this.mapCtrl.setRadius(r);
        });
      });
    }

    // 清除雷達中心
    this.dom.btnClearRadar.addEventListener("click", () => {
      this.mapCtrl.clearSearchCenter();
      this.showToast("已清除搜尋半徑圈，恢復全台檢視 🌿");
    });

    // 收藏抽屜開關
    this.dom.btnOpenFavs.addEventListener("click", () => this.openFavDrawer());
    this.dom.btnCloseFavs.addEventListener("click", () => this.closeFavDrawer());
    this.dom.favOverlay.addEventListener("click", () => this.closeFavDrawer());

    // 底部景點抽屜展開/收起
    this.dom.btnToggleList.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleBottomSheet();
    });
    this.dom.sheetHandle.addEventListener("click", () => {
      this.toggleBottomSheet();
    });

    // 新增景點彈窗
    this.dom.btnOpenAddTour.addEventListener("click", () => this.openAddTourModal());
    this.dom.btnCloseTourModal.addEventListener("click", () => this.closeAddTourModal());
    this.dom.tourForm.addEventListener("submit", (e) => this.handleSaveTour(e));

    // 設定彈窗
    this.dom.btnOpenSettings.addEventListener("click", () => this.openSettingsModal());
    this.dom.btnCloseSettings.addEventListener("click", () => this.closeSettingsModal());
    this.dom.btnSaveRoomCode.addEventListener("click", () => this.handleSaveRoomCode());
    if (this.dom.btnSyncDatabase) {
      this.dom.btnSyncDatabase.addEventListener("click", () => this.checkForTourUpdates(true));
    }

    // 行程清單彈窗
    this.dom.btnOpenSchedule.addEventListener("click", () => this.openScheduleModal());
    this.dom.btnCloseSchedule.addEventListener("click", () => this.closeScheduleModal());

    // 備份匯出/匯入
    const btnExport = document.getElementById("btn-export-json");
    const fileImport = document.getElementById("file-import-json");
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        const json = window.tourSync.exportDataJson();
        const blob = new Blob([json], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `台灣真人導覽地圖備份_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        this.showToast("已下載兩人導覽與收藏備份檔 💾");
      });
    }
    if (fileImport) {
      fileImport.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          const ok = window.tourSync.importDataJson(evt.target.result);
          if (ok) {
            this.showToast("成功匯入備份資料！🎉");
            this.closeSettingsModal();
          } else {
            this.showToast("匯入格式不符合，請確認 JSON 檔案");
          }
        };
        reader.readAsText(file);
      });
    }
  }

  toggleBottomSheet() {
    this.dom.spotsSheet.classList.toggle("collapsed");
    const isCol = this.dom.spotsSheet.classList.contains("collapsed");
    this.dom.btnToggleList.innerText = isCol ? "🔼 展開列表" : "🔽 收起列表";
  }

  updateQuickChipStates() {
    if (this.dom.btnQuickToday) {
      this.dom.btnQuickToday.classList.toggle("active", this.selectedTimeSlot === "open-today");
    }
    if (this.dom.btnQuickFree) {
      this.dom.btnQuickFree.classList.toggle("active", this.selectedTimeSlot === "free");
    }
  }

  // 處理地點/關鍵字搜尋
  async handleSearch() {
    const q = this.dom.searchInput.value.trim();
    if (!q) {
      this.showToast("請輸入要搜尋的地名、地址或景點 🔍");
      return;
    }

    // 優先比對導覽資料庫中是否有對應景點 (例如 "中台", "中台禪寺", "故宮", "奇美")
    const matchedTour = this.allTours.find(t => 
      (t.name && t.name.toLowerCase().includes(q.toLowerCase())) || 
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q.toLowerCase()))) ||
      (t.summary && t.summary.toLowerCase().includes(q.toLowerCase()))
    );

    if (matchedTour) {
      this.keyword = "";
      this.mapCtrl.setSearchCenter(matchedTour.lat, matchedTour.lng, matchedTour.name, true);
      this.showToast(`已找到「${matchedTour.name}」！雷達鎖定周邊 🎯`);
      setTimeout(() => {
        this.focusSpotById(matchedTour.id);
      }, 500);
      return;
    }

    this.showToast(`正在搜尋「${q}」周邊 5 公里導覽... ⏳`);
    const loc = await this.mapCtrl.searchLocation(q);
    if (!loc) {
      this.keyword = q;
      this.applyFilters();
      this.showToast(`在地圖上搜尋不到「${q}」，已為您做關鍵字景點比對 🔎`);
    } else {
      this.keyword = "";
      this.showToast(`已鎖定「${loc.name}」！雷達搜尋周邊 5km 導覽 🎯`);
    }
  }

  // 處理即時定位 (Google Maps 風格，支援高精度 GPS 與 IP 智慧雙重備援)
  async handleGps() {
    if (this.dom.btnFloatingGps) {
      this.dom.btnFloatingGps.classList.add("locating");
    }
    if (this.dom.btnGps) {
      this.dom.btnGps.disabled = true;
    }
    this.showToast("正在取得您的即時位置... 🛰️");

    try {
      const pos = await this.mapCtrl.locateUser();
      if (this.dom.btnFloatingGps) {
        this.dom.btnFloatingGps.classList.add("active");
      }
      if (pos.source === "gps") {
        this.showToast("📍 已精準定位至您的目前位置！周邊 5 公里導覽已就緒 🎯");
      } else {
        this.showToast(`📍 已透過網路定位至所在地（${pos.city || "台灣"}）！周邊 5 公里導覽已就緒 🎯`);
      }
    } catch (e) {
      console.warn("定位失敗:", e);
      this.showToast("定位失敗：請確認網路連線或已允許瀏覽器位置存取 📍");
    } finally {
      if (this.dom.btnFloatingGps) {
        this.dom.btnFloatingGps.classList.remove("locating");
      }
      if (this.dom.btnGps) {
        this.dom.btnGps.disabled = false;
      }
    }
  }

  // 判斷景點今天是否休館
  static isClosedToday(tour) {
    if (!tour.closedDays || !Array.isArray(tour.closedDays)) return false;
    const todayDay = new Date().getDay(); // 0(週日)~6(週六)
    return tour.closedDays.includes(todayDay);
  }

  // 計算今日最近場次狀態與倒數
  static getTodayUpcomingStatus(tour) {
    if (TourApp.isClosedToday(tour)) {
      return { isClosed: true, text: "⚠️ 今日休館", isUpcoming: false, nextTime: null };
    }

    if (!tour.schedule || !Array.isArray(tour.schedule) || tour.schedule.length === 0) {
      return { isClosed: false, text: "🟢 詳洽館方", isUpcoming: false, nextTime: null };
    }

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let nextSession = null;
    let minDiff = Infinity;

    for (const timeStr of tour.schedule) {
      const [h, m] = timeStr.split(":").map(Number);
      const sessionMins = h * 60 + m;
      const diff = sessionMins - currentMins;

      if (diff >= 0 && diff < minDiff) {
        minDiff = diff;
        nextSession = timeStr;
      }
    }

    if (nextSession) {
      if (minDiff <= 60) {
        return { isClosed: false, text: `⏳ 下一場 ${nextSession} (還有 ${minDiff} 分鐘)`, isUpcoming: true, nextTime: nextSession };
      }
      return { isClosed: false, text: `🟢 今日下一場 ${nextSession}`, isUpcoming: true, nextTime: nextSession };
    }

    return { isClosed: false, text: "🏁 今日場次已結束", isUpcoming: false, nextTime: null };
  }

  // 綜合過濾與排序邏輯
  applyFilters() {
    const center = this.mapCtrl.currentSearchCenter;
    const radius = this.mapCtrl.searchRadiusKm;

    let list = this.allTours.map(t => {
      const copy = { ...t };
      if (center) {
        copy._distance = TourMapController.calculateDistanceKm(
          center.lat, center.lng, copy.lat, copy.lng
        );
      } else {
        copy._distance = null;
      }
      copy._todayStatus = TourApp.getTodayUpcomingStatus(copy);
      return copy;
    });

    // 1. 若處於 5km 雷達模式，嚴格過濾半徑內景點
    if (center) {
      list = list.filter(t => t._distance <= radius);
      list.sort((a, b) => a._distance - b._distance);
      
      this.dom.radarInfoBar.classList.remove("hidden");
      this.dom.radarText.innerHTML = `已鎖定 <strong>${center.label}</strong> 周邊 <strong>${radius}km</strong>（找到 <strong>${list.length}</strong> 個真人導覽）`;
    } else {
      this.dom.radarInfoBar.classList.add("hidden");
    }

    // 2. 縣市篩選
    if (this.selectedCounty !== "全部縣市") {
      list = list.filter(t => t.county === this.selectedCounty);
    }

    // 3. 關鍵字搜尋
    if (this.keyword) {
      const k = this.keyword.toLowerCase();
      list = list.filter(t => 
        (t.name && t.name.toLowerCase().includes(k)) ||
        (t.summary && t.summary.toLowerCase().includes(k)) ||
        (t.address && t.address.toLowerCase().includes(k)) ||
        (t.price && t.price.toLowerCase().includes(k)) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(k)))
      );
    }

    // 4. 時段與倒數快篩
    if (this.selectedTimeSlot === "upcoming") {
      list = list.filter(t => t._todayStatus.isUpcoming);
    } else if (this.selectedTimeSlot === "morning") {
      list = list.filter(t => Array.isArray(t.schedule) && t.schedule.some(s => parseInt(s.split(":")[0]) < 12));
    } else if (this.selectedTimeSlot === "afternoon") {
      list = list.filter(t => Array.isArray(t.schedule) && t.schedule.some(s => parseInt(s.split(":")[0]) >= 12));
    } else if (this.selectedTimeSlot === "free") {
      list = list.filter(t => (t.priceType && t.priceType.includes("免費")) || (t.price && t.price.includes("免費")));
    } else if (this.selectedTimeSlot === "open-today") {
      list = list.filter(t => !t._todayStatus.isClosed);
    }

    this.filteredTours = list;
    this.renderMapMarkers();
    this.renderSpotsList();
  }

  // 渲染地圖標記
  renderMapMarkers() {
    this.mapCtrl.renderMarkers(
      this.filteredTours,
      (id) => window.tourSync.isFavorite(id),
      (t) => TourApp.isClosedToday(t)
    );
  }

  // 渲染底部可展開景點卡片列表
  renderSpotsList() {
    this.dom.spotsCountText.innerText = `${this.filteredTours.length} 個景點`;

    if (this.filteredTours.length === 0) {
      this.dom.spotsListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🍃</span>
          <p>此區域周邊 5 公里內暫未找到真人導覽</p>
          <small>您可以拖曳地圖至鄰近市區、或切換上方縣市做功課喔！</small>
        </div>
      `;
      return;
    }

    const html = this.filteredTours.map(t => {
      const isFav = window.tourSync.isFavorite(t.id);
      const isClosed = TourApp.isClosedToday(t);
      const gmapsUrl = TourShareAndCalendar.getGoogleMapsNavUrl(t);
      const status = t._todayStatus || TourApp.getTodayUpcomingStatus(t);

      return `
        <div class="spot-card ${isFav ? 'is-fav' : ''}" data-id="${t.id}">
          <div class="spot-card-top">
            <div class="spot-card-title-group">
              <h4 class="spot-card-name" onclick="window.app.focusSpotById('${t.id}')">${t.name}</h4>
              <span class="spot-card-sub">📍 ${t.county} · ${t.district || ''}</span>
            </div>
            <button class="btn-icon-fav ${isFav ? 'active' : ''}" onclick="window.app.toggleFavorite('${t.id}')" title="收藏">
              ${isFav ? '💛' : '🤍'}
            </button>
          </div>

          <div class="spot-card-badges">
            <span class="badge ${status.isClosed ? 'badge-closed' : 'badge-open'}">${status.text}</span>
            ${t._distance !== null ? `<span class="badge badge-distance">📏 距離 ${t._distance} km</span>` : ''}
            <span class="badge badge-price">💰 ${t.price || '免費'}</span>
          </div>

          <p class="spot-card-summary">
            <strong>🎙️ 導覽概述：</strong>${t.summary || '專人現場深度解說。'}
          </p>

          ${t.ticketTiers ? `
            <div class="spot-card-tickets">
              <div class="card-ticket-line">🎟️ <strong>全票：</strong>${t.ticketTiers.regular}</div>
              <div class="card-ticket-line">🎓 <strong>優待：</strong>${t.ticketTiers.concession}</div>
              <div class="card-ticket-line">🧓 <strong>免票：</strong>${t.ticketTiers.free}</div>
              ${t.ticketTiers.events ? `<div class="card-ticket-promo">🎁 <strong>活動優惠：</strong>${t.ticketTiers.events}</div>` : ''}
            </div>
          ` : ''}

          <div class="spot-card-meta-line">
            <span>⏰ 場次：${Array.isArray(t.schedule) ? t.schedule.join(', ') : t.schedule}</span>
            <span>📅 休館：${t.closedText || '無'}</span>
          </div>

          <div class="spot-card-actions">
            <a href="${gmapsUrl}" target="_blank" class="btn btn-sm btn-gmaps">🗺️ Google 導航</a>
            ${t.officialUrl ? `<a href="${t.officialUrl}" target="_blank" class="btn btn-sm btn-official">🔗 官網詳情</a>` : ''}
            <button class="btn btn-sm btn-share" onclick="window.TourShareAndCalendar.shareToPartner(window.app.getTourById('${t.id}'))">📲 LINE 分享</button>
            <button class="btn btn-sm btn-cal" onclick="window.app.addToCalendar('${t.id}')">📅 加行事曆</button>
          </div>
        </div>
      `;
    }).join("");

    this.dom.spotsListContainer.innerHTML = html;
  }

  // 渲染右側縣市分類收藏抽屜
  renderFavoritesDrawer(favIds) {
    if (!favIds || favIds.length === 0) {
      this.dom.favListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">💛</span>
          <p>目前還沒有收藏任何導覽景點喔！</p>
          <small>在地圖或卡片點擊愛心，就會依縣市分類整理在這裡～</small>
        </div>
      `;
      return;
    }

    const favTours = favIds
      .map(id => this.getTourById(id))
      .filter(t => t !== null);

    const groups = {};
    favTours.forEach(tour => {
      const c = tour.county || "其他地區";
      if (!groups[c]) groups[c] = [];
      groups[c].push(tour);
    });

    let html = "";
    Object.keys(groups).sort().forEach(countyName => {
      const spots = groups[countyName];
      html += `
        <div class="fav-county-group">
          <div class="fav-county-header">
            <span class="fav-county-title">📍 ${countyName}</span>
            <span class="fav-county-count">${spots.length} 處景點</span>
          </div>
          <div class="fav-county-items">
            ${spots.map(t => `
              <div class="fav-item-card">
                <div class="fav-item-info" onclick="window.app.focusSpotById('${t.id}'); window.app.closeFavDrawer();">
                  <div class="fav-item-name">${t.name}</div>
                  <div class="fav-item-meta">⏰ ${Array.isArray(t.schedule) ? t.schedule.join('、') : t.schedule} · 💰 ${t.price || '免費'}</div>
                </div>
                <div class="fav-item-actions">
                  <button class="btn-icon-unfav" onclick="window.app.toggleFavorite('${t.id}')" title="取消收藏">🗑️</button>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    });

    this.dom.favListContainer.innerHTML = html;
  }

  // 渲染兩人共享行程視窗
  renderScheduleModal(schedules) {
    if (!schedules || schedules.length === 0) {
      this.dom.scheduleListContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📅</span>
          <p>目前還沒有加入任何導覽行程</p>
          <small>在景點卡片點擊「加行事曆」，兩人的預定行程就會同步呈現在這裡！</small>
        </div>
      `;
      return;
    }

    const html = schedules.map(s => `
      <div class="schedule-item-card">
        <div class="schedule-item-left">
          <div class="schedule-date">📅 ${s.scheduledDate} · ⏰ ${s.time}</div>
          <div class="schedule-name">🎙️ ${s.tourName} (${s.county})</div>
          <div class="schedule-fee">費用：${s.price || '免費'}</div>
        </div>
        <button class="btn-del-sched" onclick="window.app.removeScheduleItem('${s.id}')">✕</button>
      </div>
    `).join("");

    this.dom.scheduleListContainer.innerHTML = html;
  }

  // 切換收藏並同步
  toggleFavorite(tourId) {
    const isNowFav = window.tourSync.toggleFavorite(tourId);
    const tour = this.getTourById(tourId);
    const name = tour ? tour.name : "景點";
    if (isNowFav) {
      this.showToast(`已收藏「${name}」💛 (兩人即時同步)`);
    } else {
      this.showToast(`已取消收藏「${name}」`);
    }
    this.renderMapMarkers();
    this.renderSpotsList();
  }

  // 加入行事曆 (同時產出 iPhone .ics 與兩人雲端共享日程)
  addToCalendar(tourId) {
    const tour = this.getTourById(tourId);
    if (!tour) return;
    const res = TourShareAndCalendar.addToIPhoneCalendar(tour);
    this.showToast(`已將「${tour.name}」加入行事曆與兩人行程！📅`);
  }

  removeScheduleItem(id) {
    window.tourSync.removeSharedSchedule(id);
    this.showToast("已移除該項行程記錄");
  }

  focusSpotById(id) {
    const tour = this.getTourById(id);
    if (tour) {
      this.mapCtrl.focusSpot(tour);
    }
  }

  getTourById(id) {
    return this.allTours.find(t => t.id === id) || null;
  }

  updateFavCountBadge(count) {
    if (this.dom.favCountBadge) {
      this.dom.favCountBadge.innerText = count;
      this.dom.favCountBadge.style.display = count > 0 ? "inline-block" : "none";
    }
  }

  // 縣市選單產生
  renderCountyFilterOptions() {
    let html = `<option value="全部縣市">🏛️ 全台灣 22 縣市</option>`;
    Object.keys(TAIWAN_REGIONS).forEach(region => {
      html += `<optgroup label="—— ${region}地區 ——">`;
      TAIWAN_REGIONS[region].forEach(c => {
        html += `<option value="${c}">${c}</option>`;
      });
      html += `</optgroup>`;
    });
    this.dom.countySelect.innerHTML = html;
  }

  openFavDrawer() {
    this.dom.favDrawer.classList.add("open");
    this.dom.favOverlay.classList.add("open");
  }

  closeFavDrawer() {
    this.dom.favDrawer.classList.remove("open");
    this.dom.favOverlay.classList.remove("open");
  }

  openAddTourModal() {
    this.dom.modalTour.classList.remove("hidden");
  }

  closeAddTourModal() {
    this.dom.modalTour.classList.add("hidden");
    this.dom.tourForm.reset();
  }

  handleSaveTour(e) {
    e.preventDefault();
    const name = document.getElementById("form-name").value.trim();
    const county = document.getElementById("form-county").value;
    const district = document.getElementById("form-district").value.trim();
    const address = document.getElementById("form-address").value.trim();
    const lat = parseFloat(document.getElementById("form-lat").value);
    const lng = parseFloat(document.getElementById("form-lng").value);
    const scheduleStr = document.getElementById("form-schedule").value.trim();
    const duration = document.getElementById("form-duration").value.trim();
    const price = document.getElementById("form-price").value.trim();
    const summary = document.getElementById("form-summary").value.trim();
    const officialUrl = document.getElementById("form-url").value.trim();
    const closedText = document.getElementById("form-closed").value.trim();

    if (!name || isNaN(lat) || isNaN(lng)) {
      this.showToast("請確實填寫景點名稱與正確座標");
      return;
    }

    const schedule = scheduleStr ? scheduleStr.split(/[,，\s]+/) : ["10:30", "14:30"];

    const newTour = {
      id: "custom-" + Date.now(),
      name,
      county,
      district,
      address,
      lat,
      lng,
      tourType: "定時導覽",
      schedule,
      duration: duration || "約45分鐘",
      priceType: price.includes("免費") ? "免費" : "需購票或付費",
      price: price || "免費",
      summary: summary || "由專業導覽人員帶路解說。",
      officialUrl: officialUrl || "",
      closedDays: closedText.includes("一") ? [1] : [],
      closedText: closedText || "無",
      tags: ["自訂景點", "真人解說"]
    };

    window.tourSync.saveCustomTour(newTour);
    this.showToast(`成功新增「${name}」導覽資訊！(兩人同步更新) 🎉`);
    this.closeAddTourModal();
  }

  openSettingsModal() {
    this.dom.modalSettings.classList.remove("hidden");
    this.dom.inputRoomCode.value = window.tourSync.roomCode;
    this.updateCloudStatusBadge();
  }

  closeSettingsModal() {
    this.dom.modalSettings.classList.add("hidden");
  }

  handleSaveRoomCode() {
    const code = this.dom.inputRoomCode.value.trim();
    if (!code) {
      this.showToast("房間代碼不能為空喔！");
      return;
    }
    window.tourSync.setRoomCode(code);
    this.updateRoomCodeDisplay();
    this.showToast(`已切換至兩人同步房間「${code}」！💞`);
    this.closeSettingsModal();
  }

  updateRoomCodeDisplay() {
    if (this.dom.currentRoomBadge) {
      this.dom.currentRoomBadge.innerText = window.tourSync.roomCode;
    }
  }

  updateCloudStatusBadge() {
    const badge = document.getElementById("cloud-status-indicator");
    if (badge) {
      badge.innerHTML = window.tourSync.isCloudConnected
        ? `<span class="badge-status-online">🟢 雲端即時連線中 (雙向毫秒級同步)</span>`
        : `<span class="badge-status-offline">🟡 本地模式 (隨時可填入 Firebase 金鑰實現雲端推播)</span>`;
    }
  }

  openScheduleModal() {
    this.dom.modalSchedule.classList.remove("hidden");
    this.renderScheduleModal(window.tourSync.getSharedSchedules());
  }

  closeScheduleModal() {
    this.dom.modalSchedule.classList.add("hidden");
  }

  showToast(msg, duration = 3000) {
    if (!this.dom.toast) return;
    this.dom.toast.innerText = msg;
    this.dom.toast.classList.add("show");
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.dom.toast.classList.remove("show");
    }, duration);
  }

  checkIPhonePwaPrompt() {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

    if (isIos && !isStandalone) {
      const dismissed = localStorage.getItem("ios_pwa_dismissed");
      if (!dismissed) {
        const banner = document.getElementById("ios-install-banner");
        if (banner) {
          banner.classList.remove("hidden");
          document.getElementById("btn-dismiss-ios-banner").addEventListener("click", () => {
            banner.classList.add("hidden");
            localStorage.setItem("ios_pwa_dismissed", "true");
          });
        }
      }
    }
  }
}

window.app = new TourApp();
document.addEventListener("DOMContentLoaded", () => {
  window.app.init();
});
