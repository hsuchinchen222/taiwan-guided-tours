/**
 * 情侶行事曆與 LINE 分享管理器 (Calendar & Share Manager)
 * 支援 iPhone 行事曆 (.ics 匯入)、兩人共享日程雲端記錄、與 LINE 原生分享
 */

class TourShareAndCalendar {
  // 生成 iPhone / 蘋果行事曆 (.ics) 檔並引導加入
  static addToIPhoneCalendar(tour, chosenTime = null) {
    const timeStr = chosenTime || (Array.isArray(tour.schedule) ? tour.schedule[0] : "10:00");
    const [hours, minutes] = timeStr.split(":").map(n => parseInt(n, 10));

    // 預設為下一個符合的參觀日（如果今天時間已過，則預設安排在週末或明天）
    const now = new Date();
    const tourDate = new Date();
    tourDate.setHours(hours || 10, minutes || 0, 0, 0);

    // 如果今天該時段已過，預設為明天同一時間
    if (tourDate < now) {
      tourDate.setDate(tourDate.getDate() + 1);
    }

    const pad = (n) => String(n).padStart(2, '0');
    const formatDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

    const startDateStr = formatDate(tourDate);
    const endDate = new Date(tourDate.getTime() + 60 * 60 * 1000); // 預設 1 小時
    const endDateStr = formatDate(endDate);

    const description = `【真人導覽內容】\\n${tour.summary || '專業導覽人員帶路解說'}\\n\\n【費用】${tour.price || '免費'}\\n【官方連結】${tour.officialUrl || ''}\\n【Google Maps】https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tour.name)}`;

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Couple Taiwan Tour Map//ZH-TW",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `SUMMARY:🎙️ ${tour.name} - 真人導覽`,
      `DESCRIPTION:${description}`,
      `LOCATION:${tour.address || tour.name}`,
      `DTSTART:${startDateStr}`,
      `DTEND:${endDateStr}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:提醒：真人導覽即將在 30 分鐘後開始！",
      "TRIGGER:-PT30M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    // 1. 同步記錄到「兩人共享行程清單」中
    if (window.tourSync) {
      window.tourSync.addToSharedSchedule({
        tourId: tour.id,
        tourName: tour.name,
        county: tour.county,
        scheduledDate: tourDate.toLocaleDateString('zh-TW'),
        time: timeStr,
        price: tour.price,
        addedAt: new Date().toISOString()
      });
    }

    // 2. 觸發 iPhone 行事曆下載/匯入
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${tour.name}_真人導覽行程.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return {
      date: tourDate.toLocaleDateString('zh-TW'),
      time: timeStr
    };
  }

  // 專為情侶設計的 LINE 原生分享
  static shareToPartner(tour, timeStr = null) {
    const timeInfo = timeStr ? `\n⏰ 推薦場次：${timeStr}` : (tour.schedule ? `\n⏰ 場次時間：${Array.isArray(tour.schedule) ? tour.schedule.join('、') : tour.schedule}` : '');
    const gmapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(tour.name + ' ' + (tour.address || ''))}`;
    
    const shareText = `親愛的～我在【台灣真人導覽地圖】看到一個很棒的真人導覽景點！想跟妳一起去聽解說 💛\n\n` +
      `🏛️ 景點：${tour.name} (${tour.county || ''})\n` +
      `🎙️ 導覽特色：${tour.summary || '專業真人解說'}\n` +
      `${timeInfo}\n` +
      `💰 費用：${tour.price || '免費'}\n` +
      `📍 地址：${tour.address || ''}\n\n` +
      `🔗 官網詳情：${tour.officialUrl || ''}\n` +
      `🗺️ Google Maps 導航：${gmapsUrl}`;

    // 如果支援 Web Share API (iPhone Safari 原生分享面闆)
    if (navigator.share) {
      navigator.share({
        title: `🎙️ 推薦景點：${tour.name} 真人導覽`,
        text: shareText,
        url: tour.officialUrl || window.location.href
      }).catch(err => {
        if (err.name !== 'AbortError') {
          this.fallbackLineShare(shareText);
        }
      });
    } else {
      this.fallbackLineShare(shareText);
    }
  }

  // LINE 備用跳轉或剪貼簿複製
  static fallbackLineShare(text) {
    // 嘗試喚起 LINE
    const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(text)}`;
    window.open(lineUrl, '_blank');
  }

  // 取得 Google Maps 原生導航連結
  static getGoogleMapsNavUrl(tour) {
    const destination = encodeURIComponent(`${tour.name} ${tour.address || ''}`);
    return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  }
}

window.TourShareAndCalendar = TourShareAndCalendar;
