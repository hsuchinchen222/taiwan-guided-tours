/**
 * 雲端雙向即時同步管理員 (Cloud Realtime Sync Manager)
 * 支援「兩人專屬房間代碼」(Room Code) 雙向即時推播 + 本地 LocalStorage 離線快取
 * 內建 MQTT over WebSocket 免費公共即時通訊，免開電腦即可在不同手機間秒級同步！
 */

class TourSyncManager {
  constructor() {
    this.storageKeyRoom = "tour_room_code";
    this.storageKeyFavs = "tour_favorites_local";
    this.storageKeyCustom = "tour_custom_tours";
    this.storageKeySchedule = "tour_shared_schedule";
    this.storageKeyFirebaseConfig = "tour_firebase_config";

    // 預設房間代碼
    this.roomCode = localStorage.getItem(this.storageKeyRoom) || "sweet-couple-tour";
    
    // 本地快取狀態
    this.favorites = this.loadLocalJson(this.storageKeyFavs, []);
    this.customTours = this.loadLocalJson(this.storageKeyCustom, []);
    this.sharedSchedules = this.loadLocalJson(this.storageKeySchedule, []);

    // 監聽回呼函數
    this.favCallbacks = [];
    this.toursCallbacks = [];
    this.scheduleCallbacks = [];

    // 連線狀態
    this.isCloudConnected = false;
    this.clientId = "couple_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
    this.mqttTopic = `tw_tour_sync_v2/${this.roomCode}`;
    this.mqttClient = null;

    // Firebase 實例與資料庫參考 (選用自建備援)
    this.firebaseApp = null;
    this.db = null;

    // 啟動 MQTT 即時同步與 Firebase 初始化
    this.initMqttSync();
    this.initFirebase();
  }

  loadLocalJson(key, defaultVal) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultVal;
    } catch (e) {
      console.warn("讀取本機快取失敗:", e);
      return defaultVal;
    }
  }

  saveLocalJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn("寫入本機快取失敗:", e);
    }
  }

  // 設定房間代碼 (切換不同情侶配對房間)
  setRoomCode(code) {
    if (!code) return;
    const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanCode) return;
    
    if (this.mqttClient && this.mqttClient.connected && this.mqttTopic) {
      try {
        this.mqttClient.unsubscribe(this.mqttTopic);
      } catch (e) {}
    }

    this.roomCode = cleanCode;
    localStorage.setItem(this.storageKeyRoom, cleanCode);
    this.mqttTopic = `tw_tour_sync_v2/${this.roomCode}`;

    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.subscribe(this.mqttTopic, { qos: 1 }, () => {
        console.log(`[TourSync] 已切換至房間頻道: ${this.mqttTopic}`);
        this.broadcastSync();
      });
    }

    if (this.db) {
      this.attachListeners();
    }

    this.updateUiCloudStatus();
    this.notifyAll();
  }

  // 初始化 MQTT over WebSocket 免費公共即時通訊 (24/7 免開電腦跨手機秒級同步)
  initMqttSync() {
    if (typeof mqtt === "undefined") {
      console.warn("[TourSync] 尚未載入 MQTT 函式庫，延遲重試...");
      setTimeout(() => this.initMqttSync(), 1000);
      return;
    }

    try {
      // 採用全球高可用免註冊 WSS 代理 (EMQX)
      const brokerUrl = "wss://broker.emqx.io:8084/mqtt";
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: this.clientId,
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 3000
      });

      this.mqttClient.on("connect", () => {
        console.log(`[TourSync] 雲端 MQTT 通道連線成功！房間: ${this.roomCode}`);
        this.isCloudConnected = true;
        this.updateUiCloudStatus();

        this.mqttClient.subscribe(this.mqttTopic, { qos: 1 }, (err) => {
          if (!err) {
            console.log(`[TourSync] 成功訂閱兩人房間頻道: ${this.mqttTopic}`);
            // 發布在線握手，促使若對方在線上立即回傳最新狀態
            this.mqttClient.publish(
              this.mqttTopic,
              JSON.stringify({ type: "hello", senderId: this.clientId }),
              { qos: 1 }
            );
          }
        });
      });

      this.mqttClient.on("message", (topic, message) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.senderId === this.clientId) return; // 略過自己發出的廣播

          if (data.type === "hello") {
            // 對方剛上線，把目前的收藏與行程推播過去
            this.broadcastSync();
            return;
          }

          if (data.type === "sync_state" && data.payload) {
            let changed = false;

            // 1. 收藏聯集整合
            if (Array.isArray(data.payload.favorites)) {
              const currentSet = new Set(this.favorites);
              let hasNew = false;
              data.payload.favorites.forEach(id => {
                if (!currentSet.has(id)) {
                  currentSet.add(id);
                  hasNew = true;
                }
              });
              if (hasNew) {
                this.favorites = Array.from(currentSet);
                this.saveLocalJson(this.storageKeyFavs, this.favorites);
                changed = true;
              }
            }

            // 2. 共享行程整合
            if (Array.isArray(data.payload.sharedSchedules)) {
              const map = new Map();
              this.sharedSchedules.forEach(s => map.set(s.id, s));
              let schedChanged = false;
              data.payload.sharedSchedules.forEach(s => {
                if (!map.has(s.id)) {
                  map.set(s.id, s);
                  schedChanged = true;
                }
              });
              if (schedChanged) {
                this.sharedSchedules = Array.from(map.values());
                this.saveLocalJson(this.storageKeySchedule, this.sharedSchedules);
                changed = true;
              }
            }

            // 3. 自訂景點整合
            if (Array.isArray(data.payload.customTours)) {
              const map = new Map();
              this.customTours.forEach(t => map.set(t.id, t));
              let toursChanged = false;
              data.payload.customTours.forEach(t => {
                if (!map.has(t.id)) {
                  map.set(t.id, t);
                  toursChanged = true;
                }
              });
              if (toursChanged) {
                this.customTours = Array.from(map.values());
                this.saveLocalJson(this.storageKeyCustom, this.customTours);
                changed = true;
              }
            }

            if (changed) {
              this.notifyAll();
              if (window.app && window.app.showToast) {
                window.app.showToast("👫 另一半同步了新的景點收藏或行程！💛");
              }
            }
          }
        } catch (err) {
          console.warn("[TourSync] 處理同步訊息異常:", err);
        }
      });

      this.mqttClient.on("error", (err) => {
        console.warn("[TourSync] MQTT 連線異常:", err);
        this.isCloudConnected = false;
        this.updateUiCloudStatus();
      });

      this.mqttClient.on("offline", () => {
        this.isCloudConnected = false;
        this.updateUiCloudStatus();
      });
    } catch (e) {
      console.warn("[TourSync] MQTT 初始化失敗:", e);
    }
  }

  // 廣播本機最新收藏與行程 (使用 retain: true 保證離線後連線立即可收)
  broadcastSync() {
    if (this.mqttClient && this.mqttClient.connected && this.mqttTopic) {
      const payload = {
        senderId: this.clientId,
        type: "sync_state",
        timestamp: Date.now(),
        payload: {
          favorites: this.favorites,
          sharedSchedules: this.sharedSchedules,
          customTours: this.customTours
        }
      };
      this.mqttClient.publish(
        this.mqttTopic,
        JSON.stringify(payload),
        { qos: 1, retain: true }
      );
    }
  }

  updateUiCloudStatus() {
    const badge = document.getElementById("cloud-status-indicator");
    if (badge) {
      badge.innerHTML = this.isCloudConnected
        ? `<span class="badge-status-online" style="color:#2E7D32; font-weight:600;">🟢 雲端同步連線中（房間：${this.roomCode}）跨手機秒級同步</span>`
        : `<span class="badge-status-offline" style="color:#E07A5F; font-weight:600;">🟡 離線快取模式 (正在重新連線...)</span>`;
    }
  }

  // 初始化 Firebase (若使用者自帶設定)
  initFirebase() {
    const savedConfig = this.loadLocalJson(this.storageKeyFirebaseConfig, null);
    
    if (savedConfig && window.firebase && window.firebase.initializeApp) {
      try {
        if (!firebase.apps.length) {
          this.firebaseApp = firebase.initializeApp(savedConfig);
        } else {
          this.firebaseApp = firebase.app();
        }
        this.db = firebase.database();
        this.isCloudConnected = true;
        this.attachListeners();
        console.log("[TourSync] Firebase Realtime Database 連線成功！房間代碼:", this.roomCode);
        this.updateUiCloudStatus();
        return;
      } catch (err) {
        console.warn("[TourSync] Firebase 初始化略過:", err);
      }
    }
  }

  // 監聽 Firebase 房間資料變更
  attachListeners() {
    if (!this.db) return;
    const roomRef = this.db.ref(`rooms/${this.roomCode}`);

    roomRef.child("favorites").on("value", (snapshot) => {
      const val = snapshot.val();
      if (val !== null) {
        this.favorites = Array.isArray(val) ? val : Object.keys(val);
        this.saveLocalJson(this.storageKeyFavs, this.favorites);
        this.favCallbacks.forEach(cb => cb(this.favorites));
      }
    });

    roomRef.child("customTours").on("value", (snapshot) => {
      const val = snapshot.val();
      if (val !== null) {
        this.customTours = Object.values(val);
        this.saveLocalJson(this.storageKeyCustom, this.customTours);
        this.toursCallbacks.forEach(cb => cb(this.customTours));
      }
    });

    roomRef.child("schedules").on("value", (snapshot) => {
      const val = snapshot.val();
      if (val !== null) {
        this.sharedSchedules = Object.values(val);
        this.saveLocalJson(this.storageKeySchedule, this.sharedSchedules);
        this.scheduleCallbacks.forEach(cb => cb(this.sharedSchedules));
      }
    });
  }

  // 切換收藏狀態
  toggleFavorite(tourId) {
    const index = this.favorites.indexOf(tourId);
    if (index > -1) {
      this.favorites.splice(index, 1);
    } else {
      this.favorites.push(tourId);
    }
    this.saveLocalJson(this.storageKeyFavs, this.favorites);

    // 跨裝置同步廣播
    this.broadcastSync();

    // Firebase 備援
    if (this.db) {
      const favMap = {};
      this.favorites.forEach(id => { favMap[id] = true; });
      this.db.ref(`rooms/${this.roomCode}/favorites`).set(favMap);
    }

    this.favCallbacks.forEach(cb => cb(this.favorites));
    return this.isFavorite(tourId);
  }

  isFavorite(tourId) {
    return this.favorites.includes(tourId);
  }

  getFavorites() {
    return [...this.favorites];
  }

  // 新增或更新自訂導覽景點
  saveCustomTour(tour) {
    if (!tour.id) {
      tour.id = "custom-" + Date.now();
    }
    const idx = this.customTours.findIndex(t => t.id === tour.id);
    if (idx > -1) {
      this.customTours[idx] = tour;
    } else {
      this.customTours.push(tour);
    }
    this.saveLocalJson(this.storageKeyCustom, this.customTours);

    // 跨裝置廣播
    this.broadcastSync();

    if (this.db) {
      this.db.ref(`rooms/${this.roomCode}/customTours/${tour.id}`).set(tour);
    }

    this.toursCallbacks.forEach(cb => cb(this.customTours));
    return tour;
  }

  // 刪除自訂景點
  deleteCustomTour(tourId) {
    this.customTours = this.customTours.filter(t => t.id !== tourId);
    this.saveLocalJson(this.storageKeyCustom, this.customTours);

    this.broadcastSync();

    if (this.db) {
      this.db.ref(`rooms/${this.roomCode}/customTours/${tourId}`).remove();
    }
    this.toursCallbacks.forEach(cb => cb(this.customTours));
  }

  getCustomTours() {
    return [...this.customTours];
  }

  // 兩人共享行程 (Shared Schedule)
  addToSharedSchedule(scheduleItem) {
    if (!scheduleItem.id) {
      scheduleItem.id = "sched-" + Date.now();
    }
    this.sharedSchedules.push(scheduleItem);
    this.saveLocalJson(this.storageKeySchedule, this.sharedSchedules);

    this.broadcastSync();

    if (this.db) {
      this.db.ref(`rooms/${this.roomCode}/schedules/${scheduleItem.id}`).set(scheduleItem);
    }
    this.scheduleCallbacks.forEach(cb => cb(this.sharedSchedules));
  }

  removeSharedSchedule(scheduleId) {
    this.sharedSchedules = this.sharedSchedules.filter(s => s.id !== scheduleId);
    this.saveLocalJson(this.storageKeySchedule, this.sharedSchedules);

    this.broadcastSync();

    if (this.db) {
      this.db.ref(`rooms/${this.roomCode}/schedules/${scheduleId}`).remove();
    }
    this.scheduleCallbacks.forEach(cb => cb(this.sharedSchedules));
  }

  getSharedSchedules() {
    return [...this.sharedSchedules];
  }

  // 註冊變更監聽器
  onFavoritesChanged(callback) {
    this.favCallbacks.push(callback);
    callback(this.favorites);
  }

  onToursChanged(callback) {
    this.toursCallbacks.push(callback);
    callback(this.customTours);
  }

  onScheduleChanged(callback) {
    this.scheduleCallbacks.push(callback);
    callback(this.sharedSchedules);
  }

  notifyAll() {
    this.favCallbacks.forEach(cb => cb(this.favorites));
    this.toursCallbacks.forEach(cb => cb(this.customTours));
    this.scheduleCallbacks.forEach(cb => cb(this.sharedSchedules));
  }

  // 儲存使用者自訂的 Firebase 設定
  saveFirebaseConfig(config) {
    this.saveLocalJson(this.storageKeyFirebaseConfig, config);
    this.initFirebase();
  }

  // 匯出全部資料 JSON
  exportDataJson() {
    return JSON.stringify({
      roomCode: this.roomCode,
      favorites: this.favorites,
      customTours: this.customTours,
      sharedSchedules: this.sharedSchedules,
      exportDate: new Date().toISOString()
    }, null, 2);
  }

  // 匯入資料 JSON
  importDataJson(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.favorites)) {
        this.favorites = data.favorites;
        this.saveLocalJson(this.storageKeyFavs, this.favorites);
      }
      if (Array.isArray(data.customTours)) {
        this.customTours = data.customTours;
        this.saveLocalJson(this.storageKeyCustom, this.customTours);
      }
      if (Array.isArray(data.sharedSchedules)) {
        this.sharedSchedules = data.sharedSchedules;
        this.saveLocalJson(this.storageKeySchedule, this.sharedSchedules);
      }
      if (data.roomCode) {
        this.setRoomCode(data.roomCode);
      }
      this.broadcastSync();
      this.notifyAll();
      return true;
    } catch (e) {
      console.error("匯入資料失敗:", e);
      return false;
    }
  }
}

// 建立全域同步實例
window.tourSync = new TourSyncManager();
