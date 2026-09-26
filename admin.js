const EVENT = window.debutConfig;
const BUCKET = "debut-photos";
const loginPanel = document.getElementById("login-panel");
const dashboard = document.getElementById("dashboard");
const loginMessage = document.getElementById("login-message");
const adminMessage = document.getElementById("admin-message");
const adminGrid = document.getElementById("admin-grid");
let client;
let currentStatus = "pending";
let rows = [];

const formatDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const makeButton = (label, callback, className = "") => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", callback);
  return button;
};
const showLogin = (text = "") => {
  loginPanel.hidden = false;
  dashboard.hidden = true;
  loginMessage.textContent = text;
};
const isOrganizer = async () => {
  const { data, error } = await client.rpc("is_photo_admin");
  if (error) throw error;
  return data === true;
};
const initializeOrganizer = async () => {
  if (!await isOrganizer()) {
    await client.auth.signOut();
    showLogin("This account is not authorized to manage the debut gallery.");
    return;
  }
  loginPanel.hidden = true;
  dashboard.hidden = false;
  adminMessage.textContent = "";
  await loadSubmissions();
};
const setActiveStatus = (status) => {
  currentStatus = status;
  document.querySelectorAll(".admin-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.status === status));
  renderSubmissions();
};
const updateStatistics = () => {
  const totals = { pending: 0, approved: 0, rejected: 0, hidden: 0 };
  rows.forEach((row) => { totals[row.status] += 1; });
  document.getElementById("pending-count").textContent = totals.pending;
  document.getElementById("approved-count").textContent = totals.approved;
  document.getElementById("rejected-count").textContent = totals.rejected;
  document.getElementById("hidden-count").textContent = totals.hidden;
  document.getElementById("admin-stats").innerHTML = `
    <div class="admin-stat"><strong>${rows.length}</strong><span>Total submissions</span></div>
    <div class="admin-stat"><strong>${totals.pending}</strong><span>Awaiting review</span></div>
    <div class="admin-stat"><strong>${totals.approved}</strong><span>In public gallery</span></div>`;
};
const loadSubmissions = async () => {
  adminGrid.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "admin-empty";
  loading.textContent = "Loading submissions…";
  adminGrid.append(loading);
  const { data, error } = await client.from("photo_submissions").select("*").eq("event_id", EVENT.eventId).order("created_at", { ascending: false });
  if (error) throw error;
  rows = data || [];
  updateStatistics();
  await renderSubmissions();
};
const renderSubmissions = async () => {
  adminGrid.replaceChildren();
  const filtered = rows.filter((row) => row.status === currentStatus);
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = currentStatus === "pending" ? "No memories are waiting for review." : `No ${currentStatus} memories yet.`;
    adminGrid.append(empty);
    return;
  }
  for (const row of filtered) {
    const { data: signed, error } = await client.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600, { download: false });
    if (error) {
      console.error("Could not create media preview URL", error);
      continue;
    }
    const card = document.createElement("article");
    card.className = "admin-item";
    const media = document.createElement(row.mime_type.startsWith("video/") ? "video" : "img");
    media.className = "admin-item-media";
    media.src = signed.signedUrl;
    media.preload = "metadata";
    if (media.tagName === "VIDEO") {
      media.controls = true;
      media.playsInline = true;
    } else {
      media.alt = row.caption || `Guest memory from ${row.guest_name}`;
      media.loading = "lazy";
    }
    const title = document.createElement("h2");
    title.textContent = row.guest_name;
    const caption = document.createElement("p");
    caption.textContent = row.caption || "No caption";
    const filename = document.createElement("p");
    filename.textContent = row.original_filename;
    const date = document.createElement("p");
    date.textContent = `Uploaded ${formatDate(row.created_at)}`;
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    if (row.status !== "approved" && row.status !== "hidden") actions.append(makeButton("Approve", () => changeStatus(row, "approved")));
    if (row.status !== "rejected") actions.append(makeButton("Reject", () => changeStatus(row, "rejected")));
    if (row.status === "approved") actions.append(makeButton("Hide", () => changeStatus(row, "hidden")));
    if (row.status === "hidden") actions.append(makeButton("Unhide", () => changeStatus(row, "approved")));
    actions.append(makeButton("Download", () => downloadOne(row)));
    actions.append(makeButton("Remove", () => removeRow(row), "admin-danger"));
    card.append(media, title, caption, filename, date, actions);
    adminGrid.append(card);
  }
};
const changeStatus = async (row, status) => {
  adminMessage.textContent = "Saving moderation change…";
  const now = new Date().toISOString();
  const approvedAt = status === "approved" ? now : status === "hidden" ? row.approved_at || now : null;
  const { error } = await client.from("photo_submissions").update({
    status,
    approved_at: approvedAt,
    rejected_at: status === "rejected" ? now : null
  }).eq("id", row.id);
  if (error) {
    adminMessage.textContent = error.message;
    return;
  }
  row.status = status;
  row.approved_at = approvedAt;
  row.rejected_at = status === "rejected" ? now : null;
  updateStatistics();
  adminMessage.textContent = status === "pending" ? "Memory hidden from the public gallery." : `Memory ${status}.`;
  await renderSubmissions();
};
const getDownload = async (row) => {
  const { data, error } = await client.storage.from(BUCKET).download(row.storage_path);
  if (error) throw error;
  return data;
};
const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
};
const safeFilename = (filename) => filename.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
const downloadOne = async (row) => {
  adminMessage.textContent = `Preparing ${row.original_filename}…`;
  try {
    saveBlob(await getDownload(row), safeFilename(row.original_filename));
    adminMessage.textContent = "Download started.";
  } catch (error) {
    adminMessage.textContent = error.message || "Download failed.";
  }
};
const removeRow = async (row) => {
  if (!window.confirm(`Permanently remove ${row.original_filename}?`)) return;
  adminMessage.textContent = "Removing memory…";
  const { error: storageError } = await client.storage.from(BUCKET).remove([row.storage_path]);
  if (storageError) {
    adminMessage.textContent = storageError.message;
    return;
  }
  const { error } = await client.from("photo_submissions").delete().eq("id", row.id);
  if (error) {
    adminMessage.textContent = `The file was removed, but its record could not be deleted: ${error.message}`;
    return;
  }
  rows = rows.filter((item) => item.id !== row.id);
  updateStatistics();
  adminMessage.textContent = "Memory permanently removed.";
  await renderSubmissions();
};
const downloadCollection = async () => {
  const approved = rows.filter((row) => row.status === "approved");
  if (!approved.length) {
    adminMessage.textContent = "There are no approved memories to download.";
    return;
  }
  if (!window.JSZip) {
    adminMessage.textContent = "The archive library could not load. Try downloading files individually.";
    return;
  }
  const button = document.getElementById("download-all");
  button.disabled = true;
  adminMessage.textContent = `Preparing 0 of ${approved.length} memories…`;
  try {
    const archive = new window.JSZip();
    for (let index = 0; index < approved.length; index += 1) {
      const row = approved[index];
      archive.file(`${String(index + 1).padStart(2, "0")}-${safeFilename(row.original_filename)}`, await getDownload(row));
      adminMessage.textContent = `Preparing ${index + 1} of ${approved.length} memories…`;
    }
    const blob = await archive.generateAsync({ type: "blob" });
    saveBlob(blob, `${EVENT.name.toLowerCase()}-debut-memories.zip`);
    adminMessage.textContent = "Your approved collection download has started.";
  } catch (error) {
    adminMessage.textContent = error.message || "Could not prepare the collection archive.";
  } finally {
    button.disabled = false;
  }
};

document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("login-button");
  button.disabled = true;
  loginMessage.textContent = "Signing in…";
  const { data, error } = await client.auth.signInWithPassword({
    email: document.getElementById("admin-email").value.trim(),
    password: document.getElementById("admin-password").value
  });
  button.disabled = false;
  if (error) {
    loginMessage.textContent = error.message;
    return;
  }
  try {
    await initializeOrganizer();
  } catch (accessError) {
    await client.auth.signOut();
    showLogin(accessError.message || "Could not verify organizer access.");
  }
});
document.getElementById("sign-out").addEventListener("click", async () => {
  await client.auth.signOut();
  showLogin("You have signed out.");
});
document.getElementById("download-all").addEventListener("click", downloadCollection);
document.querySelectorAll(".admin-tab").forEach((tab) => tab.addEventListener("click", () => setActiveStatus(tab.dataset.status)));

window.debutSupabaseReady.then(async (supabaseClient) => {
  client = supabaseClient;
  document.getElementById("login-button").disabled = false;
  const { data: { session } } = await client.auth.getSession();
  if (session) {
    try { await initializeOrganizer(); }
    catch (error) { await client.auth.signOut(); showLogin(error.message || "Could not verify organizer access."); }
  }
}).catch((error) => {
  showLogin(error.message || "Organizer tools are not configured yet.");
  document.getElementById("login-button").disabled = true;
});
