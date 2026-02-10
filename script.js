// --- FUNGSI NAVIGASI HALAMAN ---
function showPage(pageId) {
  // Sembunyikan semua halaman
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  // Tampilkan halaman yang dipilih
  document.getElementById(pageId).classList.add("active");

  // Update status tombol navigasi
  document

    .querySelectorAll(".nav-item")
    .forEach((btn) => btn.classList.remove("active"));
  if (pageId === "dashboard")
    document.getElementById("btn-dashboard").classList.add("active");
  if (pageId === "riwayat")
    document.getElementById("btn-riwayat").classList.add("active");
  if (pageId === "user")
    document.getElementById("btn-user").classList.add("active");
  if (pageId === "config")
    document.getElementById("btn-config").classList.add("active");

  // Tutup sidebar jika di mobile setelah pindah halaman
  closeSidebar();

  // Tutup sidebar jika di mobile setelah pindah halaman
  closeSidebar();
}

// --- SIDEBAR TOGGLE LOGIC ---
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const btnToggleNav = document.getElementById("btn-toggle-nav");

btnToggleNav.addEventListener("click", () => {
  sidebar.classList.toggle("active");
  sidebarOverlay.classList.toggle("active");
});

sidebarOverlay.addEventListener("click", closeSidebar);

function closeSidebar() {
  sidebar.classList.remove("active");
  sidebarOverlay.classList.remove("active");
}

// --- CONFIG FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyAnfF_Cs_wwyGaqB9Z91RwR9Fv7AR0jk2Y",
  authDomain: "monitoring-9bffa.firebaseapp.com",
  databaseURL: "https://monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "monitoring-9bffa",
  storageBucket: "monitoring-9bffa.firebasestorage.app",
  messagingSenderId: "893322341036",
  appId: "1:893322341036:web:e9a4c298dc41a73ca10d09",
  measurementId: "G-92ZKF4PY4J"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// --- STATE MANAGEMENT MULTI-DEVICE ---
let currentDeviceId = null;
const deviceSelect = document.getElementById("device-select");

// 1. Fetch Daftar Device saat Load
function loadDevices() {
  db.ref("/devices").once("value").then(snapshot => {
    const devices = snapshot.val();
    deviceSelect.innerHTML = ""; // Clear existing

    if (devices) {
      const deviceIds = Object.keys(devices);

      // Populate Dropdown
      deviceIds.forEach(id => {
        const option = document.createElement("option");
        option.value = id;
        option.text = id; // Bisa diganti alias jika ada
        deviceSelect.appendChild(option);
      });

      // Auto-select first device
      if (deviceIds.length > 0) {
        switchDevice(deviceIds[0]);
        deviceSelect.value = deviceIds[0];
      }
    } else {
      deviceSelect.innerHTML = `<option>Tidak ada device</option>`;
      alert("Tidak ada data device ditemukan di database.");
    }
  });
}

// Event Listener Dropdown
deviceSelect.addEventListener("change", (e) => {
  switchDevice(e.target.value);
});

// Fungsi Ganti Device (Detach Listener Lama & Attach Listener Baru)
function switchDevice(deviceId) {
  if (currentDeviceId) {
    // Detach listener lama
    db.ref(`/devices/${currentDeviceId}/data/volume`).off();
    db.ref(`/devices/${currentDeviceId}/data/tinggi`).off();
    db.ref(`/devices/${currentDeviceId}/data/history`).off();
    db.ref(`/devices/${currentDeviceId}/data/logs`).off();
  }

  currentDeviceId = deviceId;
  console.log("Switched to Device:", currentDeviceId);

  // FETCH CONFIG FIRST, THEN ATTACH LISTENERS
  db.ref(`/devices/${deviceId}/config`).once("value").then(snapshot => {
    currentDeviceConfig = snapshot.val();
    console.log("Config Loaded:", currentDeviceConfig);

    // Attach Listener Baru SETELAH config loaded
    attachListeners(currentDeviceId);
  });
}

// Panggil saat main
loadDevices();

// --- LOGIC UI DASHBOARD ---
const batteryFill = document.getElementById("battery-fill");
const percVal = document.getElementById("perc-val");
const statusText = document.getElementById("status-text");
const alertBar = document.getElementById("alert-bar");
const alertPerc = document.getElementById("alert-perc");
const pTinggi = document.getElementById("p-tinggi");
const pVolume = document.getElementById("p-volume");
const pEstimasi = document.getElementById("p-estimasi");

// --- CONFIGURATION STATE ---
let currentDeviceConfig = null;

function updateUI(volume) {
  // Wrapper
  currentVol = volume;
  renderDashboard();
  return;
  /* Old Logic Removed */
  let maxVolume = 440; // Default fallback

  if (currentDeviceConfig && currentDeviceConfig.tank) {
    const { length, width, height } = currentDeviceConfig.tank;
    if (length > 0 && width > 0 && height > 0) {
      maxVolume = (length * width * height) / 1000.0;
    }
  }

  let percentage = Math.round((volume / maxVolume) * 100);
  if (percentage > 100) percentage = 100;
  if (percentage < 0) percentage = 0;

  percVal.innerText = percentage + "%";
  pVolume.innerText = volume.toFixed(1) + " L";

  // Hitung Estimasi (Based on Config Engine LPH)
  let lph = 20; // Default
  if (currentDeviceConfig && currentDeviceConfig.engine && currentDeviceConfig.engine.consumption_lph) {
    lph = currentDeviceConfig.engine.consumption_lph;
  }

  const hours = volume / lph;
  // Konversi ke Jam & Menit
  const jam = Math.floor(hours);
  const menit = Math.round((hours - jam) * 60);
  pEstimasi.innerText = `± ${jam} Jam ${menit} Menit`;

  batteryFill.style.height = `calc(${percentage}% - 10px)`;

  let color = "";
  let status = "";

  if (percentage >= 80) {
    color = "#2ecc71";
    status = "Sangat Aman";
    alertBar.style.display = "none";
  } else if (percentage >= 60) {
    color = "#f1c40f";
    status = "Cukup";
    alertBar.style.display = "none";
  } else if (percentage >= 40) {
    color = "#e67e22";
    status = "Waspada";
    alertBar.style.display = "none";
  } else if (percentage >= 20) {
    color = "#e67e22";
    status = "Menipis";
    alertBar.style.display = "none";
  } else {
    color = "#e74c3c";
    status = "Bahaya";
    alertBar.style.display = "flex";
    alertPerc.innerText = percentage;
  }

  batteryFill.style.backgroundColor = color;
  percVal.style.color = color;
  statusText.innerText = status;
  statusText.style.color = color;
}



// --- FUNGSI LISTENER DINAMIS ---
let currentVol = 0;
let currentH = 0;

function attachListeners(deviceId) {
  const basePath = `/devices/${deviceId}/data`;

  // 1. REALTIME VOLUME
  db.ref(`${basePath}/volume`).on("value", (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      currentVol = val;
      renderDashboard();
    }
  });

  // 2. REALTIME TINGGI
  db.ref(`${basePath}/tinggi`).on("value", (snapshot) => {
    const val = snapshot.val();
    if (val !== null) {
      currentH = val;
      renderDashboard();
    }
  });

  // 3. RIWAYAT OP
  db.ref(`${basePath}/history`).on("value", (snapshot) => {
    handleHistoryData(snapshot.val());
  });

  // 4. LOGS
  db.ref(`${basePath}/logs`).on("value", (snapshot) => {
    handleLogsData(snapshot.val());
  });
}

function renderDashboard() {
  // STRICT LOGIC FROM USER REQUEST:
  // 1. Tinggi Bahan Bakar = Tinggi Tangki - Jarak Sensor (This is `currentH` from firmware)
  // 2. Volume = Calculated from Height vs Tank Dimensions
  // 3. Estimate = Volume / LPH
  // 4. Blind Spot < 20cm => 100% Percentage

  // Default Config if missing
  let cfgLength = 100;
  let cfgWidth = 100;
  let cfgHeight = 100; // Tank Height
  let cfgLPH = 20;

  if (currentDeviceConfig) {
    if (currentDeviceConfig.tank) {
      if (currentDeviceConfig.tank.length) cfgLength = currentDeviceConfig.tank.length;
      if (currentDeviceConfig.tank.width) cfgWidth = currentDeviceConfig.tank.width;
      if (currentDeviceConfig.tank.height) cfgHeight = currentDeviceConfig.tank.height;
    }
    if (currentDeviceConfig.engine && currentDeviceConfig.engine.consumption_lph) {
      cfgLPH = currentDeviceConfig.engine.consumption_lph;
    }
  }

  // Calculate Max Volume
  const maxVolume = (cfgLength * cfgWidth * cfgHeight) / 1000.0;

  // Render Height
  pTinggi.innerText = currentH + " CM";

  // Calculate Volume based on Height (Strictly)
  // Volume = L * W * FuelHeight
  let calcVolume = (cfgLength * cfgWidth * currentH) / 1000.0;

  // Use firmware volume if available as primary source, OR force calculated?
  // User said "liter/volume baan bakar didapat dari tinggi bahan bakar terhadap volume tanki"
  // If firmware sends volume, it uses the same formula.
  // EXCEPT for blind spot.

  // Blind Spot Logic: Distance < 20cm => 100%
  // Distance = TankHeight - FuelHeight
  const distance = cfgHeight - currentH;

  let percentage = 0;

  if (distance < 23 && distance >= 0) {
    // Blind Spot Handling -> Force 100%
    percentage = 100;
    // Force volume to max
    calcVolume = maxVolume;
  } else {
    percentage = Math.round((calcVolume / maxVolume) * 100);
  }

  // Clamp
  if (percentage > 100) percentage = 100;
  if (percentage < 0) percentage = 0;

  // Update UI Text
  percVal.innerText = percentage + "%";
  pVolume.innerText = calcVolume.toFixed(1) + " L";

  // Estimate
  const hours = calcVolume / cfgLPH;
  const jam = Math.floor(hours);
  const menit = Math.round((hours - jam) * 60);
  pEstimasi.innerText = `± ${jam} Jam ${menit} Menit`;

  // Battery Visual
  batteryFill.style.height = `calc(${percentage}% - 10px)`;

  // Status & Color
  let color = "";
  let status = "";

  if (percentage >= 80) {
    color = "#2ecc71";
    status = "Sangat Aman";
    alertBar.style.display = "none";
  } else if (percentage >= 60) {
    color = "#f1c40f";
    status = "Cukup";
    alertBar.style.display = "none";
  } else if (percentage >= 40) {
    color = "#e67e22";
    status = "Waspada";
    alertBar.style.display = "none";
  } else if (percentage >= 20) {
    color = "#e67e22";
    status = "Menipis";
    alertBar.style.display = "none";
  } else {
    color = "#e74c3c";
    status = "Bahaya";
    alertBar.style.display = "flex";
    alertPerc.innerText = percentage;
  }

  batteryFill.style.backgroundColor = color;
  percVal.style.color = color;
  statusText.innerText = status;
  statusText.style.color = color;
}

// --- LOGIKA REAL-TIME & HISTORY ---

// State Global untuk Data
let operationalHistoryData = [];
let fuelLogData = [];

const logTableBody = document.getElementById("log-table-body");
const riwayatTableBody = document.getElementById("riwayat-table-body");

const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const btnFilter = document.getElementById("btn-filter");

const btnExportRiwayat = document.getElementById("btn-export-riwayat");
const btnExportLogs = document.getElementById("btn-export-logs");

// 1. DATA RIWAYAT OPERASIONAL (Fetch from /genset/history)
// 1. DATA RIWAYAT OPERASIONAL (Handler Baru)
function handleHistoryData(data) {
  operationalHistoryData = []; // Reset

  if (data) {
    // Convert Object to Array
    Object.keys(data).forEach((key) => {
      operationalHistoryData.push({
        id: key,
        ...data[key],
      });
    });

    // Urutkan berdasarkan tanggal descending (terbaru diatas)
    // Asumsi format tanggal di DB bisa diparsing atau string ISO. 
    // Jika format DD/MM/YYYY, kita perlu parse manual untuk sorting.
    // Disini saya pakai simple reverse jika data masuk berurutan, atau sort by key.
    // Urutkan berdasarkan tanggal descending (terbaru diatas)
    operationalHistoryData.reverse();
  }

  renderRiwayat(operationalHistoryData);
}

// Render Fungsi Riwayat
function renderRiwayat(data) {
  riwayatTableBody.innerHTML = "";

  if (data.length === 0) {
    riwayatTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Tidak ada data.</td></tr>`;
    return;
  }

  data.forEach((item) => {
    const row = `
      <tr>
        <td class="admin-only-col check-col">
            <input type="checkbox" class="admin-checkbox riwayat-check" value="${item.id}">
        </td>
        <td class="date-cell">
           <span>${item.tanggal || "-"}</span>
           <button class="btn-delete" onclick="deleteHistory('${item.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
        <td>${item.jam_nyala || "-"}</td>
        <td>${item.durasi || "-"}</td>
        <td>${item.konsumsi_bbm || "-"}</td>
        <td><span class="status-badge">${item.status || "Normal"}</span></td>
      </tr>
    `;
    riwayatTableBody.innerHTML += row;
  });
}


// 2. DATA LOG PERUBAHAN BAHAN BAKAR (PERSISTENT /genset/logs)
// 2. DATA LOG PERUBAHAN BAHAN BAKAR (Handler Baru)
function handleLogsData(data) {
  fuelLogData = [];

  if (data) {
    // Convert Object to Array
    Object.keys(data).forEach((key) => {
      fuelLogData.push({
        id: key,
        ...data[key],
      });
    });

    // Reverse agar terbaru diatas
    fuelLogData.reverse();
  }

  // Render Logs
  renderLogs(fuelLogData);
}

function renderLogs(data) {
  logTableBody.innerHTML = "";

  if (data.length === 0) {
    logTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Belum ada data log baru.</td></tr>`;
    return;
  }

  data.forEach((item) => {
    // Parse Tanggal & Jam
    let datePart = "-";
    let timePart = "-";
    if (item.tanggal) {
      const parts = item.tanggal.split(" ");
      if (parts.length >= 2) {
        datePart = parts[0];
        timePart = parts[1];
      } else {
        datePart = item.tanggal;
      }
    }

    // Hitung Perubahan
    let volAwal = parseFloat(item.volume_awal || 0);
    let volAkhir = parseFloat(item.volume_akhir || 0);
    let diff = volAkhir - volAwal;

    let volumeText = "";
    let volumeStyle = "";
    let activityBadge = "";

    if (diff >= 0) {
      volumeText = "+ " + diff.toFixed(1) + " L";
      volumeStyle = "color: #2e7d32; font-weight: 600;";
      activityBadge = `<span class="status-badge badge-fill"><i class="fa-solid fa-gas-pump"></i> Pengisian</span>`;
    } else {
      volumeText = "- " + Math.abs(diff).toFixed(1) + " L";
      volumeStyle = "color: #e67e22; font-weight: 600;";
      activityBadge = `<span class="status-badge badge-drain"><i class="fa-solid fa-arrow-trend-down"></i> Pemakaian</span>`;
    }

    const row = `
        <tr>
            <td class="admin-only-col check-col">
                <input type="checkbox" class="admin-checkbox logs-check" value="${item.id}">
            </td>
            <td class="date-cell">
              <span>${datePart}</span>
              <button class="btn-delete" onclick="deleteLog('${item.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
            <td>${timePart}</td>
            <td style="${volumeStyle}">${volumeText}</td>
            <td>${activityBadge}</td>
            <td>${item.status || "Normal"}</td>
        </tr>
      `;
    logTableBody.innerHTML += row;
  });
}


// --- 3. FITUR FILTER TANGGAL ---
btnFilter.addEventListener("click", applyFilter);

function applyFilter() {
  const startVal = startDateInput.value; // YYYY-MM-DD 
  const endVal = endDateInput.value;     // YYYY-MM-DD

  // Filter Data Riwayat
  const filteredRiwayat = filterDataByDate(operationalHistoryData, startVal, endVal);
  renderRiwayat(filteredRiwayat);

  // Filter Data Logs
  const filteredLogs = filterDataByDate(fuelLogData, startVal, endVal);
  renderLogs(filteredLogs);


  // Toggle Expanded Class
  const isFiltered = startVal !== "" || endVal !== "";
  const riwayatContainer = document.getElementById("riwayat-container");
  const logsContainer = document.getElementById("logs-container");

  if (isFiltered) {
    riwayatContainer.classList.add("expanded");
    logsContainer.classList.add("expanded");
  } else {
    riwayatContainer.classList.remove("expanded");
    logsContainer.classList.remove("expanded");
  }
}

function filterDataByDate(dataArray, startDateStr, endDateStr) {
  if (!startDateStr && !endDateStr) return dataArray; // No filter

  let start = null;
  if (startDateStr) {
    const [sy, sm, sd] = startDateStr.split("-");
    start = new Date(sy, sm - 1, sd); // Local Midnight
  }

  let end = null;
  if (endDateStr) {
    const [ey, em, ed] = endDateStr.split("-");
    end = new Date(ey, em - 1, ed); // Local Midnight
    end.setHours(23, 59, 59, 999); // End of Day
  }

  return dataArray.filter(item => {
    // Asumsi item.tanggal format "DD/MM/YYYY HH:mm" atau "DD/MM/YYYY"
    if (!item.tanggal) return false;

    // Split date & time
    const [datePart, timePart] = item.tanggal.split(" ");
    const [day, month, year] = datePart.split("/");

    // Create Date object (Month is 0-indexed)
    // Ini creates Local Time
    const itemDate = new Date(year, month - 1, day);

    if (start && itemDate < start) return false;
    if (end && itemDate > end) return false;

    return true;
  });
}


// --- 4. EXPORT TO EXCEL (.xlsx) ---
btnExportRiwayat.addEventListener("click", () => {
  // Get current displayed data (bisa filtered)
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(operationalHistoryData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data untuk diexport");
    return;
  }

  // Format Data
  const formattedData = dataToExport.map(item => ({
    "Tanggal": item.tanggal,
    "Jam Nyala": item.jam_nyala,
    "Durasi": item.durasi,
    "Konsumsi BBM": item.konsumsi_bbm,
    "Status": item.status
  }));

  exportToExcel(formattedData, "Riwayat_Operasional_Genset");
});

btnExportLogs.addEventListener("click", () => {
  const startVal = startDateInput.value;
  const endVal = endDateInput.value;
  const dataToExport = filterDataByDate(fuelLogData, startVal, endVal);

  if (dataToExport.length === 0) {
    alert("Tidak ada data log untuk diexport");
    return;
  }

  const formattedData = dataToExport.map(item => {
    let volAwal = parseFloat(item.volume_awal || 0);
    let volAkhir = parseFloat(item.volume_akhir || 0);
    let diff = volAkhir - volAwal;
    let changeText = (diff >= 0 ? "+" : "") + diff.toFixed(1);

    return {
      "Tanggal": item.tanggal,
      "Volume Awal": volAwal,
      "Volume Akhir": volAkhir,
      "Perubahan": changeText,
      "Status": item.status
    };
  });

  exportToExcel(formattedData, "Log_Bahan_Bakar");
});

function exportToExcel(data, filenameBase) {
  if (!data || !data.length) return;

  // Buat Worksheet
  const worksheet = XLSX.utils.json_to_sheet(data);

  // Buat Workbook
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

  // Generate File Excel
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}

// --- ADMIN FEATURES ---
// Check Session
if (localStorage.getItem('isAdmin') === 'true') {
  document.body.classList.add('is-admin');
  showAdminDashboard(true);
}

function adminLogin() {
  const user = document.getElementById('admin-user').value;
  const pass = document.getElementById('admin-pass').value;

  if (user === 'PengawasGenset' && pass === 'Pengawas') {
    alert('Login Berhasil! Mode Admin Aktif.');
    localStorage.setItem('isAdmin', 'true');
    document.body.classList.add('is-admin');
    showAdminDashboard(true);
  } else {
    alert('Username atau Password Salah!');
  }
}

function adminLogout() {
  localStorage.removeItem('isAdmin');
  document.body.classList.remove('is-admin');
  showAdminDashboard(false);
  document.getElementById('admin-user').value = "";
  document.getElementById('admin-pass').value = "";
}

function showAdminDashboard(isLoggedIn) {
  const loginForm = document.getElementById('login-form');
  const adminDash = document.getElementById('admin-dashboard');
  const btnConfig = document.getElementById('btn-config');

  if (isLoggedIn) {
    loginForm.style.display = 'none';
    adminDash.style.display = 'block';

    // Show Config Button for Admin
    if (btnConfig) btnConfig.style.display = 'flex';
  } else {
    loginForm.style.display = 'block';
    adminDash.style.display = 'none';

    // Hide Config Button for Non-Admin
    if (btnConfig) btnConfig.style.display = 'none';

    // If currently on config page, redirect to dashboard
    if (document.getElementById('config').classList.contains('active')) {
      showPage('dashboard');
    }
  }
}

function deleteHistory(id) {
  if (confirm("Yakin ingin menghapus data riwayat ini?")) {
    if (!currentDeviceId) return;
    db.ref(`/devices/${currentDeviceId}/data/history/` + id).remove()
      .then(() => alert("Data terhapus!"))
      .catch((e) => alert("Gagal hapus: " + e.message));
  }
}

function deleteLog(id) {
  if (confirm("Yakin ingin menghapus log ini?")) {
    if (!currentDeviceId) return;
    db.ref(`/devices/${currentDeviceId}/data/logs/` + id).remove()
      .then(() => alert("Log terhapus!"))
      .catch((e) => alert("Gagal hapus: " + e.message));
  }
}

// --- BULK DELETE FEATURES ---
function toggleSelectAll(type) {
  const masterCheck = document.getElementById(type === 'riwayat' ? 'check-all-riwayat' : 'check-all-logs');
  const checkboxes = document.querySelectorAll(type === 'riwayat' ? '.riwayat-check' : '.logs-check');

  checkboxes.forEach(cb => cb.checked = masterCheck.checked);
}

function deleteSelected(type) {
  const checkboxes = document.querySelectorAll(type === 'riwayat' ? '.riwayat-check:checked' : '.logs-check:checked');

  if (checkboxes.length === 0) {
    alert("Pilih data yang ingin dihapus terlebih dahulu.");
    return;
  }

  if (confirm(`Yakin ingin menghapus ${checkboxes.length} data terpilih?`)) {
    if (!currentDeviceId) return;
    const dbPath = type === 'riwayat' ? `/devices/${currentDeviceId}/data/history/` : `/devices/${currentDeviceId}/data/logs/`;
    let promises = [];

    checkboxes.forEach(cb => {
      promises.push(db.ref(dbPath + cb.value).remove());
    });

    Promise.all(promises)
      .then(() => {
        alert("Berhasil menghapus " + checkboxes.length + " data.");
        // Uncheck master checkbox
        const masterCheck = document.getElementById(type === 'riwayat' ? 'check-all-riwayat' : 'check-all-logs');
        if (masterCheck) masterCheck.checked = false;
      })
      .catch((e) => alert("Terjadi kesalahan: " + e.message));
  }
} // Close deleteSelected function

// --- 6. KONFIGURASI ALAT (WAITING ROOM & PROVISIONING) ---
const waitingRoomList = document.getElementById("waiting-room-list");
const configTableBody = document.getElementById("config-table-body");
const configModal = document.getElementById("config-modal");
const modalDeviceId = document.getElementById("modal-device-id");

// Listen ke seluruh devices untuk memisahkan Pending vs Active
db.ref("/devices").on("value", (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const devices = Object.keys(data).map(key => ({ id: key, ...data[key] }));

  // 1. Filter Waiting Room (isActive != true)
  // STRICT FILTER: Hanya muncul jika isActive FALSE atau UNDEFINED
  const pendingDevices = devices.filter(d => !d.config || d.config.isActive !== true);
  if (waitingRoomList) renderWaitingRoom(pendingDevices);

  // 2. Filter Active Devices (isActive == true)
  // STRICT FILTER: Hanya muncul jika isActive TRUE
  const activeDevices = devices.filter(d => d.config && d.config.isActive === true);
  if (configTableBody) renderConfigTable(activeDevices);

  // Update Dropdown di Header agar SINKRON dengan Strict Filter
  updateDeviceDropdown(activeDevices);
});

function updateDeviceDropdown(activeDevices) {
  if (!deviceSelect) return;
  deviceSelect.innerHTML = "";
  if (activeDevices.length === 0) {
    deviceSelect.innerHTML = `<option>Tidak ada device aktif</option>`;
    return;
  }

  activeDevices.forEach(d => {
    const option = document.createElement("option");
    option.value = d.id;
    option.text = (d.config && d.config.alias) ? d.config.alias : d.id;
    deviceSelect.appendChild(option);
  });

  // Pertahankan seleksi jika masih valid
  if (currentDeviceId && activeDevices.find(d => d.id === currentDeviceId)) {
    deviceSelect.value = currentDeviceId;
  } else if (activeDevices.length > 0) {
    // Auto select first available if current invalid
    switchDevice(activeDevices[0].id);
    deviceSelect.value = activeDevices[0].id;
  }
}

function renderWaitingRoom(devices) {
  waitingRoomList.innerHTML = "";
  if (devices.length === 0) {
    waitingRoomList.innerHTML = `<p style="color: #999; margin-left: 10px;">Tidak ada perangkat baru menunggu konfigurasi.</p>`;
    return;
  }

  devices.forEach(d => {
    const card = document.createElement("div");
    card.className = "card card-pending";

    card.innerHTML = `
      <div class="new-tag">New</div>
      <h3 style="margin-top: 20px;">${d.id}</h3>
      <p>Device is online but not configured.</p>
      <div style="display: flex; gap: 10px; width: 100%;">
        <button class="btn-red" style="flex: 1;" onclick="openConfigModal('${d.id}')">
          <i class="fa-solid fa-screwdriver-wrench"></i> Configure
        </button>
        <button class="btn-delete-icon" onclick="deleteDevice('${d.id}')" title="Delete Device">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    waitingRoomList.appendChild(card);
  });
}

function renderConfigTable(devices) {
  configTableBody.innerHTML = "";
  if (devices.length === 0) {
    configTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Belum ada perangkat terdaftar.</td></tr>`;
    return;
  }

  devices.forEach(d => {
    const conf = d.config || {};
    const dim = conf.tank ? `${conf.tank.length}x${conf.tank.width}x${conf.tank.height} cm` : "-";

    const row = `
      <tr>
        <td style="font-weight: bold;">${d.id}</td>
        <td>${conf.alias || "-"}</td>
        <td>${dim}</td>
        <td>${conf.engine ? conf.engine.consumption_lph + " L/Jam" : "-"}</td>
        <td><span class="badge-active">Aktif</span></td>
        <td>
           <button class="btn-edit" onclick="openConfigModal('${d.id}')">
             <i class="fa-solid fa-pen"></i> Edit
           </button>
           <button class="btn-delete-icon" onclick="deleteDevice('${d.id}')">
             <i class="fa-solid fa-trash"></i>
           </button>
        </td>
      </tr>
    `;
    configTableBody.innerHTML += row;
  });
}

// --- DELETE LOGIC ---
function deleteDevice(deviceId) {
  if (confirm(`Apakah Anda yakin MENGHAPUS permanen perangkat ${deviceId}? Data tidak bisa dikembalikan.`)) {
    db.ref("/devices/" + deviceId).remove()
      .then(() => {
        alert("Perangkat berhasil dihapus.");
        // UI updates automatically via on("value") listener
      })
      .catch((error) => {
        alert("Gagal menghapus: " + error.message);
      });
  }
}

// --- MODAL LOGIC ---

let editingDeviceId = null;

function openConfigModal(deviceId) {
  editingDeviceId = deviceId;
  modalDeviceId.innerText = "Device ID: " + deviceId;
  configModal.style.display = "block";

  // Pre-fill data jika ada
  db.ref(`/devices/${deviceId}/config`).once("value").then(snapshot => {
    const conf = snapshot.val();
    if (conf) {
      document.getElementById("cfg-alias").value = conf.alias || "";
      if (conf.tank) {
        document.getElementById("cfg-length").value = conf.tank.length || "";
        document.getElementById("cfg-width").value = conf.tank.width || "";
        document.getElementById("cfg-height").value = conf.tank.height || "";
      }
      if (conf.engine) {
        document.getElementById("cfg-lph").value = conf.engine.consumption_lph || "";
      }
      if (conf.telegram) {
        document.getElementById("cfg-token").value = conf.telegram.bot_token || "";
        document.getElementById("cfg-chatid").value = conf.telegram.chat_id || "";
      }
      if (conf.wifi) {
        document.getElementById("cfg-ssid").value = conf.wifi.ssid || "";
        document.getElementById("cfg-pass").value = conf.wifi.pass || "";
      }
      if (conf.ethernet) {
        document.getElementById("cfg-eth-enable").checked = conf.ethernet.enable || false;
        document.getElementById("cfg-eth-static").checked = conf.ethernet.static || false;
        document.getElementById("cfg-eth-ip").value = conf.ethernet.ip || "";
        document.getElementById("cfg-eth-gateway").value = conf.ethernet.gateway || "";
        document.getElementById("cfg-eth-subnet").value = conf.ethernet.subnet || "";
        document.getElementById("cfg-eth-dns1").value = conf.ethernet.dns1 || "";
        document.getElementById("cfg-eth-dns2").value = conf.ethernet.dns2 || "";
        toggleStaticIP();
      }
    } else {
      // Reset form
      document.getElementById("config-form").reset();
    }
  });

  // Fetch & Display Network Status (Read-Only)
  db.ref(`/devices/${deviceId}/status`).once("value").then(snapshot => {
    const status = snapshot.val();
    if (status) {
      document.getElementById("stat-ssid").value = status.ssid || "-";
      document.getElementById("stat-ip").value = status.ip_address || "-";
      document.getElementById("stat-rssi").value = (status.rssi || "0") + " dBm";
      document.getElementById("stat-last-online").innerText = "Last Online: " + (status.last_online || "N/A");
    } else {
      document.getElementById("stat-ssid").value = "Offline";
      document.getElementById("stat-ip").value = "-";
      document.getElementById("stat-rssi").value = "-";
      document.getElementById("stat-last-online").innerText = "";
    }
  });
}

function closeConfigModal() {
  configModal.style.display = "none";
  editingDeviceId = null;
}

// Close modal if click outside
window.onclick = function (event) {
  if (event.target == configModal) {
    closeConfigModal();
  }
}

// --- ETHERNET TOGGLE ---
function toggleStaticIP() {
  const isChecked = document.getElementById("cfg-eth-static").checked;
  const fields = document.getElementById("eth-static-fields");
  fields.style.display = isChecked ? "block" : "none";
}

function saveConfig(e) {
  e.preventDefault();
  if (!editingDeviceId) return;

  // Simple Validation
  if (!document.getElementById("cfg-alias").value || !document.getElementById("cfg-lph").value) {
    alert("Harap isi Alias dan Konsumsi BBM!");
    return;
  }

  alert("Menyimpan konfigurasi... Perangkat akan di-update.");

  const configData = {
    isActive: true, // Mark as active
    alias: document.getElementById("cfg-alias").value,
    tank: {
      length: parseFloat(document.getElementById("cfg-length").value) || 0,
      width: parseFloat(document.getElementById("cfg-width").value) || 0,
      height: parseFloat(document.getElementById("cfg-height").value) || 0
    },
    engine: {
      consumption_lph: parseFloat(document.getElementById("cfg-lph").value) || 0
    },
    wifi: {
      ssid: document.getElementById("cfg-ssid").value,
      pass: document.getElementById("cfg-pass").value
    },
    ethernet: {
      enable: document.getElementById("cfg-eth-enable").checked,
      static: document.getElementById("cfg-eth-static").checked,
      ip: document.getElementById("cfg-eth-ip").value,
      gateway: document.getElementById("cfg-eth-gateway").value,
      subnet: document.getElementById("cfg-eth-subnet").value,
      dns1: document.getElementById("cfg-eth-dns1").value,
      dns2: document.getElementById("cfg-eth-dns2").value
    },
    telegram: {
      bot_token: document.getElementById("cfg-token").value,
      chat_id: document.getElementById("cfg-chatid").value
    }
  };

  db.ref(`/devices/${editingDeviceId}/config`).update(configData)
    .then(() => {
      alert("Berhasil! Alat telah dikonfigurasi.");
      closeConfigModal();
    })
    .catch((err) => {
      alert("Error: " + err.message);
    });
}
