const TimeCalculations = {
  intervalCount: 96,

  centeredScrollLeft(timeOffset, viewportWidth, stickyWidth, scrollWidth) {
    const target = timeOffset - (viewportWidth + stickyWidth) / 2;
    return Math.max(0, Math.min(target, scrollWidth - viewportWidth));
  },

  autoCenterSeconds(pausedUntil, now) {
    return Math.max(0, Math.ceil((pausedUntil - now) / 1000));
  },

  normalizeGridRow(row) {
    const normalized = new Array(96).fill(false);
    const offset = row.length === 60 ? 36 : 0;
    row.forEach((value, index) => {
      if (index + offset < normalized.length)
        normalized[index + offset] = value;
    });
    return normalized;
  },

  localDate(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  activitySummary(gridData) {
    const filledSlots = [];
    for (let index = 0; index < this.intervalCount; index++) {
      if (gridData.some((row) => row[index])) filledSlots.push(index);
    }
    if (!filledSlots.length) {
      return {
        firstActivity: "--", lastActivity: "--", sessionSpan: "--",
        trackedTime: "--", trackedMinutes: 0,
      };
    }

    const firstMinute = filledSlots[0] * 15;
    const lastMinute = (filledSlots[filledSlots.length - 1] + 1) * 15;
    const clockTime = (minutes) =>
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const duration = (minutes) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    const trackedMinutes = filledSlots.length * 15;
    return {
      firstActivity: clockTime(firstMinute),
      lastActivity: clockTime(lastMinute),
      sessionSpan: duration(lastMinute - firstMinute),
      trackedTime: duration(trackedMinutes),
      trackedMinutes,
    };
  },

  currentSlot(now) {
    return Math.floor((now.getHours() * 60 + now.getMinutes()) / 15) + 1;
  },

  gridPosition(now, startHour, columnCount) {
    const elapsedMinutes =
      now.getHours() * 60 + now.getMinutes() - startHour * 60;
    const intervalIndex = Math.floor(elapsedMinutes / 15);
    if (intervalIndex < 0 || intervalIndex >= columnCount) return null;

    return { intervalIndex, fraction: (elapsedMinutes % 15) / 15 };
  },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = TimeCalculations;
}
