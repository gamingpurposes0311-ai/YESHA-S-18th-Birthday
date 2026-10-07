const debut = window.debutConfig;

const backgroundAudio = document.getElementById("background-audio");
if (backgroundAudio) {
  backgroundAudio.loop = true;
  backgroundAudio.play().catch((error) => {
    console.info("Background audio autoplay was blocked:", error.name);
  });
}

const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};

setText("debutant-name", debut.name);
setText("signoff-name", debut.name);
setText("event-date", debut.dateLabel);
setText("event-time", debut.time);
const venueLink = document.getElementById("event-venue");
if (venueLink) {
  venueLink.textContent = debut.venue;
  venueLink.href = debut.venueMapUrl;
}
setText("event-location", debut.location);
document.title = `${debut.name}'s Debut | An Evening in Bloom`;

const heroImages = document.querySelectorAll(".hero-image");
const heroSlides = debut.heroSlides || [];
if (heroImages.length === 2 && heroSlides.length > 1) {
  let activeHeroImage = 0;
  let slideIndex = 0;

  window.setInterval(() => {
    let attempts = 0;
    const loadNextSlide = () => {
      slideIndex = (slideIndex + 1) % heroSlides.length;
      const preload = new Image();
      preload.onload = () => {
        const nextHeroImage = (activeHeroImage + 1) % heroImages.length;
        heroImages[nextHeroImage].src = heroSlides[slideIndex];
        heroImages[nextHeroImage].classList.toggle("is-blurred", (debut.heroBlurSlides || []).includes(heroSlides[slideIndex]));
        heroImages[nextHeroImage].classList.add("is-active");
        heroImages[activeHeroImage].classList.remove("is-active");
        activeHeroImage = nextHeroImage;
      };
      preload.onerror = () => {
        attempts += 1;
        if (attempts < heroSlides.length - 1) loadNextSlide();
      };
      preload.src = heroSlides[slideIndex];
    };
    loadNextSlide();
  }, 5000);
}

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

const uploadUrl = new URL("upload.html", window.location.href).href;
const shareUploadLink = document.querySelector(".share-upload-link");
if (shareUploadLink) shareUploadLink.href = uploadUrl;

document.querySelectorAll(".celebrant-inline").forEach((element) => { element.textContent = debut.name; });
const printQrButton = document.getElementById("print-qr");
if (printQrButton) printQrButton.addEventListener("click", () => window.print());

const qrImage = document.getElementById("qr-image");
const downloadQr = document.getElementById("download-qr");
if (qrImage && downloadQr) {
  const syncQrDownload = () => {
    const imageUrl = new URL(qrImage.getAttribute("src"), window.location.href);
    const extension = imageUrl.pathname.split(".").pop() || "png";
    downloadQr.href = imageUrl.href;
    downloadQr.download = `${debut.name.toLowerCase()}-debut-qr.${extension}`;
  };
  qrImage.addEventListener("load", syncQrDownload);
  syncQrDownload();
}

const lightbox = document.getElementById("lightbox");
const openLightbox = (submission, mediaUrl) => {
  const mediaHost = document.getElementById("lightbox-media");
  const media = document.createElement(submission.mime_type.startsWith("video/") ? "video" : "img");
  media.src = mediaUrl;
  if (media.tagName === "VIDEO") {
    media.controls = true;
    media.autoplay = true;
    media.playsInline = true;
  } else {
    media.alt = submission.caption || `Memory shared by ${submission.guest_name}`;
  }
  mediaHost.replaceChildren(media);
  const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(submission.created_at));
  document.getElementById("lightbox-caption").textContent = `${submission.guest_name}${submission.caption ? ` · ${submission.caption}` : ""} · ${dateLabel}`;
  lightbox.showModal();
};
document.getElementById("lightbox-close").addEventListener("click", () => lightbox.close());
lightbox.addEventListener("click", (event) => { if (event.target === lightbox) lightbox.close(); });

const gallery = document.getElementById("gallery-grid");
const galleryCount = document.getElementById("gallery-count");
window.debutSupabaseReady.then(async (client) => {
  const { data, error } = await client.from("photo_submissions")
    .select("id, guest_name, caption, storage_path, mime_type, created_at")
    .eq("event_id", debut.eventId)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(18);
  if (error) throw error;
  gallery.replaceChildren();
  if (!data.length) {
    gallery.innerHTML = '<div class="gallery-empty"><span aria-hidden="true">✳</span><p>Approved memories will appear here after the celebration.</p></div>';
    galleryCount.textContent = "0 / 18 approved memories";
    return;
  }
  galleryCount.textContent = `${data.length} / 18 approved memories`;
  for (const submission of data) {
    const { data: signed, error: signError } = await client.storage.from("debut-photos").createSignedUrl(submission.storage_path, 3600);
    if (signError) continue;
    const card = document.createElement("article");
    card.className = "gallery-item";
    const media = document.createElement(submission.mime_type.startsWith("video/") ? "video" : "img");
    media.src = signed.signedUrl;
    media.loading = "lazy";
    media.preload = "metadata";
    if (media.tagName === "IMG") media.alt = submission.caption || `Memory shared by ${submission.guest_name}`;
    card.append(media);
    const open = document.createElement("button");
    open.className = "gallery-open";
    open.type = "button";
    open.setAttribute("aria-label", `Open memory shared by ${submission.guest_name}`);
    open.addEventListener("click", () => openLightbox(submission, signed.signedUrl));
    const credit = document.createElement("div");
    credit.className = "gallery-credit";
    const byline = document.createElement("strong");
    byline.textContent = submission.guest_name;
    const date = document.createElement("span");
    const uploadedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(submission.created_at));
    date.textContent = `${submission.caption ? `${submission.caption} · ` : ""}${uploadedAt}`;
    credit.append(byline, date);
    card.append(open, credit);
    gallery.append(card);
  }
}).catch((error) => {
  console.error("Could not load the debut gallery", error);
  gallery.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "gallery-empty";
  const message = document.createElement("p");
  message.textContent = "The memories gallery is getting ready. Please check back soon.";
  empty.append(message);
  gallery.append(empty);
});
