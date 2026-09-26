const debut = {
  name: "Yesha",
  date: "2026-11-07T18:00:00",
  dateLabel: "Saturday, November 7, 2026",
  time: "6:00 in the evening",
  venue: "Venue to be announced",
  location: "Location details to follow"
};

const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

setText("debutant-name", debut.name);
setText("signoff-name", debut.name);
setText("event-date", debut.dateLabel);
setText("event-time", debut.time);
setText("event-venue", debut.venue);
setText("event-location", debut.location);
document.title = `${debut.name}'s Debut | An Evening in Bloom`;

const countdownIds = ["days", "hours", "minutes"];
const countdownNote = document.getElementById("countdown-note");
const targetDate = debut.date ? new Date(debut.date).getTime() : NaN;

if (Number.isFinite(targetDate)) {
  countdownNote.textContent = "Until we celebrate together.";
  const updateCountdown = () => {
    const remaining = Math.max(0, targetDate - Date.now());
    const values = [
      Math.floor(remaining / 86400000),
      Math.floor((remaining % 86400000) / 3600000),
      Math.floor((remaining % 3600000) / 60000)
    ];
    countdownIds.forEach((id, index) => setText(id, String(values[index]).padStart(2, "0")));
    if (remaining === 0) countdownNote.textContent = "The celebration is here!";
  };
  updateCountdown();
  window.setInterval(updateCountdown, 60000);
}
