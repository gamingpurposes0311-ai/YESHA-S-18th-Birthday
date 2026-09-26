const EVENT = window.debutConfig;
const BUCKET = "debut-photos";
const MAX_ITEMS = 18;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_BATCH_SIZE = 250 * 1024 * 1024;
const extensions = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  heic: "image/heic", heif: "image/heif", mp4: "video/mp4",
  mov: "video/quicktime", webm: "video/webm"
};
const form = document.getElementById("guest-upload-form");
const input = document.getElementById("media-input");
const previews = document.getElementById("preview-grid");
const message = document.getElementById("upload-message");
const progress = document.getElementById("upload-progress");
const progressFill = document.getElementById("progress-fill");
const progressLabel = document.getElementById("progress-label");
const selectedCount = document.getElementById("selected-count");
const remainingLabel = document.getElementById("remaining-count");
const nameInput = document.getElementById("guest-name");
const captionInput = document.getElementById("guest-caption");
const anonymousInput = document.getElementById("anonymous-upload");
let client;
let availableSlots = 0;
let selectedFiles = [];
let isUploading = false;
let uploadsOpen = Date.now() >= new Date(EVENT.uploadOpensAt).getTime();
let openingTimer;

["upload-celebrant", "footer-celebrant"].forEach((id) => {
  document.getElementById(id).textContent = EVENT.name;
});

document.getElementById("caption-count").textContent = `0 / 300`;
captionInput.addEventListener("input", () => {
  document.getElementById("caption-count").textContent = `${captionInput.value.length} / 300`;
});
anonymousInput.addEventListener("change", () => {
  nameInput.disabled = anonymousInput.checked;
  nameInput.value = anonymousInput.checked ? "" : nameInput.value;
  nameInput.placeholder = anonymousInput.checked ? "Sharing anonymously" : "How should we credit you?";
});

const updateUploadAvailability = () => {
  const availability = document.getElementById("upload-availability");
  const opening = new Date(EVENT.uploadOpensAt);
  uploadsOpen = Date.now() >= opening.getTime();
  availability.textContent = uploadsOpen
    ? "Camera roll is open. Choose photos or videos and they will upload automatically."
    : `Camera-roll uploads open on ${EVENT.dateLabel}. Scan this QR again on event day to share.`;
  availability.classList.toggle("is-open", uploadsOpen);
  input.disabled = !uploadsOpen || availableSlots === 0 || !client || isUploading;
  document.getElementById("dropzone").classList.toggle("is-locked", input.disabled);
  nameInput.disabled = !uploadsOpen || anonymousInput.checked;
  captionInput.disabled = !uploadsOpen;
  anonymousInput.disabled = !uploadsOpen;
  if (!uploadsOpen && Number.isFinite(opening.getTime())) {
    window.clearTimeout(openingTimer);
    const untilOpening = Math.max(0, opening.getTime() - Date.now());
    openingTimer = window.setTimeout(updateUploadAvailability, Math.min(untilOpening, 24 * 60 * 60 * 1000));
  }
};
updateUploadAvailability();

const formatBytes = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const extensionOf = (file) => file.name.split(".").pop().toLowerCase();
const normalizedType = (file) => {
  const expected = extensions[extensionOf(file)];
  if (!expected) return null;
  if (file.type && file.type !== expected && file.type !== "application/octet-stream") return null;
  return expected;
};
const setRemaining = (slots) => {
  availableSlots = Math.max(0, Math.min(MAX_ITEMS, Number(slots) || 0));
  document.getElementById("quota-number").textContent = availableSlots;
  remainingLabel.textContent = `${availableSlots} ${availableSlots === 1 ? "spot" : "spots"} left`;
  updateUploadAvailability();
  renderPreviews();
};
const refreshRemaining = async () => {
  const { data, error } = await client.rpc("get_photo_slots_left");
  if (error) throw error;
  setRemaining(data);
};
const renderPreviews = () => {
  previews.querySelectorAll("img, video").forEach((media) => URL.revokeObjectURL(media.src));
  previews.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const type = normalizedType(file);
    const card = document.createElement("article");
    card.className = "upload-preview-item";
    const media = document.createElement(type.startsWith("video/") ? "video" : "img");
    media.className = "upload-preview-media";
    media.src = URL.createObjectURL(file);
    if (media.tagName === "VIDEO") {
      media.muted = true;
      media.playsInline = true;
      media.preload = "metadata";
    } else {
      media.alt = `Selected photo: ${file.name}`;
    }
    const info = document.createElement("div");
    info.className = "upload-preview-info";
    const filename = document.createElement("strong");
    filename.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = `${formatBytes(file.size)} · ${type.startsWith("video/") ? "Video" : "Photo"}`;
    info.append(filename, size);
    const remove = document.createElement("button");
    remove.className = "preview-remove";
    remove.type = "button";
    remove.disabled = isUploading;
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      renderPreviews();
    });
    card.append(media, info, remove);
    previews.append(card);
  });
  selectedCount.textContent = selectedFiles.length ? `${selectedFiles.length} ${selectedFiles.length === 1 ? "memory" : "memories"} selected` : "No memories selected";
};

const addFiles = (incoming) => {
  if (!uploadsOpen) return;
  if (isUploading) return;
  message.textContent = "";
  let totalSize = selectedFiles.reduce((total, file) => total + file.size, 0);
  for (const file of incoming) {
    const type = normalizedType(file);
    if (!type) {
      message.textContent = `${file.name} isn't a supported photo or video. SVG and other file types are not accepted.`;
      continue;
    }
    const sizeLimit = type.startsWith("video/") ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (!file.size || file.size > sizeLimit) {
      message.textContent = `${file.name} is over the ${type.startsWith("video/") ? "100 MB video" : "10 MB image"} limit.`;
      continue;
    }
    if (selectedFiles.length >= Math.min(MAX_ITEMS, availableSlots)) {
      message.textContent = "There are no more memory spots available for this event.";
      break;
    }
    if (totalSize + file.size > MAX_BATCH_SIZE) {
      message.textContent = "Selected files exceed the 250 MB upload limit. Remove some files and try again.";
      break;
    }
    selectedFiles.push(file);
    totalSize += file.size;
  }
  renderPreviews();
  if (client && selectedFiles.length) void uploadSelected();
};

input.addEventListener("change", () => {
  addFiles(Array.from(input.files || []));
  input.value = "";
});
const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  addFiles(Array.from(event.dataTransfer.files || []));
});

const compressImage = async (file, type) => {
  if (!type.startsWith("image/") || type === "image/heic" || type === "image/heif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob || blob.size > MAX_IMAGE_SIZE) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
};
const randomId = () => crypto.randomUUID();

form.addEventListener("submit", (event) => event.preventDefault());
const uploadSelected = async () => {
  if (!client || !uploadsOpen || isUploading || !selectedFiles.length || selectedFiles.length > availableSlots) return;
  isUploading = true;
  updateUploadAvailability();
  message.textContent = "";
  progress.hidden = false;
  const total = selectedFiles.length;
  let completed = 0;
  const guestName = anonymousInput.checked ? "A guest" : nameInput.value.trim() || "A guest";
  const caption = captionInput.value.trim();
  try {
    while (selectedFiles.length) {
      const original = selectedFiles[0];
      const originalType = normalizedType(original);
      progressLabel.textContent = `Uploading memory ${completed + 1} of ${total}…`;
      const file = await compressImage(original, originalType);
      const mimeType = !file.type || file.type === "application/octet-stream" ? originalType : file.type;
      const extension = mimeType === "image/jpeg" ? "jpg" : extensionOf(file);
      const storagePath = `${EVENT.eventId}/${randomId()}.${extension}`;
      const { data: reservationId, error: reservationError } = await client.rpc("begin_photo_upload", {
        p_event_id: EVENT.eventId,
        p_guest_name: guestName,
        p_caption: caption,
        p_storage_path: storagePath,
        p_original_filename: original.name.slice(0, 255),
        p_mime_type: mimeType,
        p_file_size: file.size
      });
      if (reservationError) throw reservationError;
      try {
        const { error: storageError } = await client.storage.from(BUCKET).upload(storagePath, file, {
          cacheControl: "3600",
          contentType: mimeType,
          upsert: false
        });
        if (storageError) throw storageError;
        const { data: completed, error: completionError } = await client.rpc("complete_photo_upload", {
          p_submission_id: reservationId
        });
        if (completionError) throw completionError;
        if (!completed) throw new Error("The upload could not be added to the review queue.");
      } catch (uploadError) {
        try {
          const { error: cleanupError } = await client.storage.from(BUCKET).remove([storagePath]);
          if (cleanupError) console.warn("Private upload cleanup failed", cleanupError);
        } catch (cleanupError) {
          console.warn("Private upload cleanup failed", cleanupError);
        }
        const { error: reservationCleanupError } = await client.rpc("cancel_photo_upload", { p_submission_id: reservationId });
        if (reservationCleanupError) console.warn("Upload reservation cleanup failed", reservationCleanupError);
        throw uploadError;
      }
      selectedFiles.shift();
      completed += 1;
      progressFill.style.width = `${Math.round((completed / total) * 100)}%`;
      renderPreviews();
    }
    message.textContent = `${completed} ${completed === 1 ? "memory has" : "memories have"} been sent for approval. They will appear in Debut Memories after the organizer reviews them.`;
    nameInput.value = "";
    captionInput.value = "";
    document.getElementById("caption-count").textContent = "0 / 300";
    anonymousInput.checked = false;
    nameInput.disabled = false;
    nameInput.placeholder = "How should we credit you?";
    await refreshRemaining();
  } catch (error) {
    console.error("Guest upload failed", error);
    message.textContent = error.message || "Your upload could not be completed. Please try again.";
    try { await refreshRemaining(); } catch { /* Keep the latest known quota. */ }
  } finally {
    progress.hidden = true;
    progressFill.style.width = "0";
    isUploading = false;
    updateUploadAvailability();
    renderPreviews();
  }
};

window.debutSupabaseReady.then(async (supabaseClient) => {
  client = supabaseClient;
  await refreshRemaining();
}).catch((error) => {
  remainingLabel.textContent = "Uploads are temporarily unavailable";
  message.textContent = error.message || "The photo-sharing service is not configured yet.";
  document.getElementById("quota-number").textContent = "—";
});
