const TimeCalculations = {
  localDate(now) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  sessionTime(now, startTime, date) {
    if (!startTime) {
      return {
        endTime: "--:--",
        elapsedText: "0h 0m",
        intervalText: "-",
        elapsedMinutes: null,
        intervalsElapsed: null,
      };
    }

    const [startHour, startMinute] = startTime.split(":").map(Number);
    const startDate = date
      ? new Date(`${date}T00:00:00`)
      : new Date(now.getTime());
    startDate.setHours(startHour, startMinute, 0, 0);

    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 15);
    const endHour = String(endDate.getHours()).padStart(2, "0");
    const endMinute = String(endDate.getMinutes()).padStart(2, "0");
    const elapsedMinutes = Math.floor((now - startDate) / 60000);
    const intervalsElapsed = Math.floor(elapsedMinutes / 15);
    let intervalText;

    if (elapsedMinutes < 0) {
      intervalText = "Not started";
    } else if (intervalsElapsed >= 60) {
      intervalText = "Complete";
    } else {
      const intervalHour = Math.floor(intervalsElapsed / 4) + 1;
      const intervalInHour = (intervalsElapsed % 4) + 1;
      intervalText = `${intervalsElapsed + 1} (Hour ${intervalHour}.${intervalInHour})`;
    }

    return {
      endTime: `${endHour}:${endMinute}`,
      elapsedText: `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`,
      intervalText,
      elapsedMinutes,
      intervalsElapsed,
    };
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
