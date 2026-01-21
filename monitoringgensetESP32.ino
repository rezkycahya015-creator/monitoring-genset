#include "time.h"
#include <ArduinoJson.h>
#include <FirebaseESP32.h>
#include <UniversalTelegramBot.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// ==========================================
// 1. KONFIGURASI PENGGUNA (ISI DISINI)
// ==========================================
#define WIFI_SSID "wifi-iot"         // Ganti dengan SSID WiFi
#define WIFI_PASSWORD "password-iot" // Ganti dengan Password WiFi

#define FIREBASE_HOST                                                          \
  "monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app/" // Tanpa
                                                                        // https://
#define FIREBASE_AUTH "xmLz3TvFaWb3YZ8RWXjdlzfowdxQEv7GtAwDi0Z2"

#define BOT_TOKEN                                                              \
  "8543325034:AAHijmifk4JSunOQU69ZW7vyCmXBYI5VOm4" // Token dari BotFather
#define CHAT_ID "6184157784"                       // ID Chat penerima

// ==========================================
// 2. KONFIGURASI SENSOR & TANGKI
// ==========================================
#define TRIGGER_PIN 4
#define ECHO_PIN 33
#define SOUND_SPEED 0.0343
#define MAX_DISTANCE 90 // Tinggi Tangki (cm)

// Dimensi Tangki untuk Rumus (Panjang x Lebar)
// Volume Max = 90 * 85 * 60 / 1000 = 459 Liter
const float TANGKI_PANJANG = 85.0;
const float TANGKI_LEBAR = 60.0;
const float MAX_VOLUME_LITER = 459.0;

// ==========================================
// 3. INISIALISASI OBJEK
// ==========================================
FirebaseData firebaseData;
FirebaseConfig config;
FirebaseAuth auth;

WiFiClientSecure client;
UniversalTelegramBot bot(BOT_TOKEN, client);

// ==========================================
// 4. VARIABEL LOGIKA
// ==========================================
float lastVolume = 0;
float startVolume = 0;
float lastSentVolume = -1;
unsigned int tinggi = 0;

// Status Mesin
bool isMachineRunning = false;
unsigned long startTime = 0;
String startTimeStr = ""; // Simpan waktu string saat mulai
unsigned long lastChangeTime = 0;

// Status Notifikasi
bool isLowFuelNotified = false; // Agar tidak spam saat bensin tipis

// ==========================================
// 5. SETUP
// ==========================================
void setup() {
  Serial.begin(115200);

  // Setup Pin Sensor
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // Koneksi WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  // Setup SSL Telegram (Insecure agar cepat)
  client.setInsecure();

  // Konfigurasi Waktu (WIB)
  configTime(7 * 3600, 0, "pool.ntp.org");

  // Konfigurasi Firebase
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  firebaseData.setBSSLBufferSize(1024, 1024);

  // Notif Awal (Opsional)
  Serial.println("Sistem Siap! Menunggu data sensor...");
  bot.sendMessage(CHAT_ID, "🤖 Sistem Monitoring Genset RESTART & AKTIF", "");
}

// ==========================================
// 6. FUNGSI PENDUKUNG
// ==========================================

// Fungsi Timestamp
String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "Unknown Time";
  }
  char buffer[20];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M", &timeinfo);
  return String(buffer);
}

// Fungsi Baca Sensor Manual
float getDistanceManual() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000); // Timeout 30ms

  if (duration == 0)
    return MAX_DISTANCE; // Anggap kosong jika error
  else
    return (duration * SOUND_SPEED) / 2;
}

// ==========================================
// 7. LOOP UTAMA
// ==========================================
void loop() {
  delay(200); // Stabilitas pembacaan

  // --- AMBIL DATA ---
  float jarakFloat = getDistanceManual();
  unsigned int jarak = (unsigned int)jarakFloat;

  if (jarak > MAX_DISTANCE)
    jarak = MAX_DISTANCE;
  if (jarak < 0)
    jarak = 0;

  // Rumus Volume: (Tinggi - JarakSensor) * Panjang * Lebar / 1000
  float currentVolume =
      (90.0 - (float)jarak) * TANGKI_PANJANG * TANGKI_LEBAR * 0.001;
  if (currentVolume < 0)
    currentVolume = 0;

  tinggi = 90 - jarak;
  float persentase = (currentVolume / MAX_VOLUME_LITER) * 100.0;

  // Debug Serial (Mirip Program2)
  // Serial.print("Jarak: "); Serial.print(jarak);
  // Serial.print(" cm | Vol: "); Serial.print(currentVolume);
  // Serial.println(" L");

  // --- LOGIKA 1: FIREBASE UPDATE (Realtime) ---
  if (abs(currentVolume - lastSentVolume) >= 0.1) {
    bool volSuccess =
        Firebase.setFloat(firebaseData, "/genset/volume", currentVolume);
    bool heightSuccess =
        Firebase.setInt(firebaseData, "/genset/tinggi", tinggi);

    if (volSuccess) {
      Serial.print("Volume Update Terkirim: ");
      Serial.println(currentVolume);
      lastSentVolume = currentVolume;
    } else {
      Serial.print("Gagal Update Volume: ");
      Serial.println(firebaseData.errorReason());
    }
  }

  // --- LOGIKA 2: DETEKSI PENGISIAN BBM (Refueling) ---
  // Syarat: Volume NAIK > 2 Liter & Mesin Mati
  if (!isMachineRunning && (currentVolume - lastVolume) > 2.0) {
    String pesan = "⛽ PENGISIAN DETECTED!\n";
    pesan += "Waktu: " + getTimestamp() + "\n";
    pesan += "Awal: " + String(lastVolume, 1) + " L\n";
    pesan += "Akhir: " + String(currentVolume, 1) + " L\n";
    pesan += "Total Isi: +" + String(currentVolume - lastVolume, 1) + " L";

    bot.sendMessage(CHAT_ID, pesan, "");
    Serial.println("STATUS: Pengisian Terdeteksi! Notif terkirim.");

    // START UPDATE FIREBASE LOG (PENGISIAN)
    FirebaseJson jsonLog;
    jsonLog.set("tanggal", getTimestamp());
    jsonLog.set("volume_awal", String(lastVolume));
    jsonLog.set("volume_akhir", String(currentVolume));
    jsonLog.set("status", "Pengisian"); // Activity Type

    // Set to last_run to trigger real-time table
    // UPDATE: Push to /genset/logs for persistence
    Firebase.pushJSON(firebaseData, "/genset/logs", jsonLog);
    // Masih update last_run untuk trigger lain jika perlu, tapi fokus kita di
    // logs
    Firebase.setJSON(firebaseData, "/genset/last_run", jsonLog);
    // END UPDATE FIREBASE LOG

    lastVolume = currentVolume; // Update segera
  }

  // --- LOGIKA 3: NOTIFIKASI BENSIN HABIS (20%) ---
  // Syarat: Sisa <= 20% dan belum dikirim notifikasinya
  if (persentase <= 20.0 && !isLowFuelNotified) {
    String pesan = "⚠️ PERINGATAN: BENSIN KRITIS!\n";
    pesan += "Waktu: " + getTimestamp() + "\n";
    pesan += "Sisa BBM: " + String(currentVolume, 1) + " L (" +
             String(persentase, 0) + "%)\n";
    pesan += "Segera lakukan pengisian ulang!";

    bot.sendMessage(CHAT_ID, pesan, "");
    Serial.println("Telegram: Peringatan Bensin Habis Terkirim");
    isLowFuelNotified = true; // Kunci agar tidak spam
  }
  // Reset notifikasi jika bensin sudah diisi diatas 25%
  else if (persentase > 25.0) {
    isLowFuelNotified = false;
  }

  // --- LOGIKA 4: DETEKSI MESIN MENYALA (START) ---
  // Syarat: Volume TURUN > 0.5 Liter (indikasinya dipakai mesin)
  if (!isMachineRunning && (lastVolume - currentVolume) > 0.5) {
    isMachineRunning = true;
    startVolume = lastVolume;
    startTime = millis();
    startTimeStr = getTimestamp(); // Capture start time
    lastChangeTime = millis();

    String pesan = "⚠️ GENSET MENYALA!\n";
    pesan += "Waktu: " + startTimeStr + "\n";
    pesan += "Volume Awal: " + String(startVolume, 1) + " L";

    bot.sendMessage(CHAT_ID, pesan, "");
    Serial.println("STATUS: Mesin Terdeteksi MENYALA...");
  }

  // --- LOGIKA 5: PROSES SAAT MESIN JALAN & MATI ---
  if (isMachineRunning) {
    if (currentVolume < lastVolume) {
      lastChangeTime = millis(); // Reset timer jika bensin masih turun
    }

    // Timeout: 30 detik tidak ada penurunan = MESIN MATI
    if (millis() - lastChangeTime > 30000) {
      isMachineRunning = false;

      float totalKonsumsi = startVolume - currentVolume;
      if (totalKonsumsi < 0)
        totalKonsumsi = 0;

      unsigned long durasiMillis = millis() - startTime;
      int durasiMenit = durasiMillis / 60000;

      String status = (totalKonsumsi > 0 && totalKonsumsi < 100)
                          ? "Normal"
                          : "Check Sensor";
      String stopTimeStr = getTimestamp();

      // --- A. UPDATE RIWAYAT (/genset/history) ---
      FirebaseJson jsonHistory;
      jsonHistory.set("tanggal", startTimeStr); // Pakai waktu mulai

      // Ambil Jam dari string tanggal (DD/MM/YYYY HH:MM)
      // Kita pakai logik sederhana ambil 5 char terakhir
      String jamNyala = "00:00";
      if (startTimeStr.length() > 5) {
        jamNyala = startTimeStr.substring(startTimeStr.length() - 5);
      }
      jsonHistory.set("jam_nyala", jamNyala);

      jsonHistory.set("durasi", String(durasiMenit) + " Menit");
      jsonHistory.set("konsumsi_bbm", String(totalKonsumsi, 1) + " L");
      jsonHistory.set("status", status);

      // Push ke list history (auto-ID)
      if (Firebase.pushJSON(firebaseData, "/genset/history", jsonHistory)) {
        Serial.println("Data Riwayat Tersimpan di /genset/history!");
      } else {
        Serial.print("Gagal simpan riwayat: ");
        Serial.println(firebaseData.errorReason());
      }

      // --- B. UPDATE LOG TERKINI (/genset/last_run) ---
      FirebaseJson jsonLog;
      jsonLog.set("tanggal", stopTimeStr); // Waktu selesai
      jsonLog.set("volume_awal", String(startVolume));
      jsonLog.set("volume_akhir", String(currentVolume));
      jsonLog.set("status", "Pemakaian");

      // Kirim persistent log update
      Firebase.pushJSON(firebaseData, "/genset/logs", jsonLog);
      // Optional: keep last_run updated
      Firebase.setJSON(firebaseData, "/genset/last_run", jsonLog);

      // B. Kirim ke Telegram
      String pesan = "✅ GENSET MATI\n";
      pesan += "Waktu: " + getTimestamp() + "\n";
      pesan += "Durasi: " + String(durasiMenit) + " Menit\n";
      pesan += "Konsumsi: " + String(totalKonsumsi, 1) + " L\n";
      pesan += "Sisa BBM: " + String(currentVolume, 1) + " L\n";
      pesan += "Status: " + status;

      bot.sendMessage(CHAT_ID, pesan, "");
      Serial.println("STATUS: Mesin MATI. Laporan terkirim.");
    }
  }

  // Update variabel pembanding
  // Hanya update jika TIDAK sedang pengisian (agar logika pengisian di atas
  // terbaca)
  if (!(currentVolume - lastVolume > 2.0)) {
    lastVolume = currentVolume;
  }

  delay(1000);
}