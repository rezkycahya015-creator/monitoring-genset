#include "time.h"
#include <ArduinoJson.h>
#include <FirebaseESP32.h>
#include <UniversalTelegramBot.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiMulti.h> // LIBRARY BARU UNTUK MULTI WIFI

// ==========================================
// 1. KONFIGURASI PENGGUNA (FIREBASE & BOT)
// ==========================================
// CATATAN: Konfigurasi WiFi sekarang ada di dalam void setup()

#define FIREBASE_HOST                                                          \
  "monitoring-9bffa-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "xmLz3TvFaWb3YZ8RWXjdlzfowdxQEv7GtAwDi0Z2"

#define BOT_TOKEN "8543325034:AAHijmifk4JSunOQU69ZW7vyCmXBYI5VOm4" // Token Bot
#define CHAT_ID "6184157784"                                       // ID Chat

// ==========================================
// 1.1 KONFIGURASI DEVICE (PENTING: GANTI UTK SETIAP ALAT)
// ==========================================
#define DEVICE_ID "GENSET_01" // Ganti dengan GENSET_002, GENSET_003, dst.

// ==========================================
// 2. KONFIGURASI SENSOR & TANGKI
// ==========================================
#define TRIGGER_PIN 4
#define ECHO_PIN 33
#define SOUND_SPEED 0.0343
#define MAX_DISTANCE 90 // Tinggi Tangki (cm)

// Dimensi Tangki (Panjang x Lebar)
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
WiFiMulti wifiMulti; // Objek untuk Multi WiFi

// ==========================================
// 4. VARIABEL LOGIKA
// ==========================================
// Variabel Data Dasar
float lastVolume = 0;
float startVolume = 0;
float lastSentVolume = -1;
unsigned int tinggi = 0;

// Status Mesin & Waktu
bool isMachineRunning = false;
unsigned long startTime = 0;
String startTimeStr = "";
unsigned long lastChangeTime = 0;

// Status Notifikasi
bool isLowFuelNotified = false;

// --- VARIABEL UNTUK LOGIKA 500kVA ---
unsigned long lastCheckTime = 0;
const long CHECK_INTERVAL = 60000; // Cek setiap 1 Menit (60.000 ms)

float volumeSatuMenitLalu = 0;
int counterPenurunan = 0;
int counterDiam = 0;

// ==========================================
// 5. SETUP (KONFIGURASI WIFI DISINI)
// ==========================================
void setup() {
  Serial.begin(115200);

  // Setup Pin Sensor
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  // ------------------------------------------
  // DAFTARKAN LIST WIFI DISINI (BISA LEBIH DARI 2)
  // ------------------------------------------
  wifiMulti.addAP("zz", "z(a)nyasepuluh");     // WiFi Utama
  wifiMulti.addAP("wifi-iot", "password-iot"); // WiFi Cadangan 1
  wifiMulti.addAP("Ruang Bersama TIF",
                  "Jambicentrum"); // WiFi Cadangan 2 (Opsional)

  Serial.println("Connecting to WiFi...");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  // Loop sampai terhubung ke salah satu WiFi
  while (wifiMulti.run() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("Connected to: ");
  Serial.println(WiFi.SSID()); // Print nama WiFi yang nyangkut

  // Setup SSL Telegram
  client.setInsecure();

  // Konfigurasi Waktu (WIB GMT+7)
  configTime(7 * 3600, 0, "pool.ntp.org");

  // Konfigurasi Firebase
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  firebaseData.setBSSLBufferSize(1024, 1024);

  // Notif Awal
  Serial.println("Sistem Siap! Menunggu data sensor...");
  bot.sendMessage(CHAT_ID,
                  "🤖 Sistem Monitoring Genset (Multi-WiFi Support) AKTIF", "");
}

// ==========================================
// 6. FUNGSI PENDUKUNG
// ==========================================

// Fungsi Waktu
String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo))
    return "Unknown Time";
  char buffer[20];
  strftime(buffer, sizeof(buffer), "%d/%m/%Y %H:%M", &timeinfo);
  return String(buffer);
}

// Fungsi Sensor Manual (Raw Data)
float getDistanceManual() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0)
    return -1.0;
  return (duration * SOUND_SPEED) / 2;
}

// FUNGSI SMOOTHING (Rata-rata)
float getSmoothedDistance() {
  float total = 0;
  int validCount = 0;

  for (int i = 0; i < 15; i++) {
    float val = getDistanceManual();
    if (val > 0 && val < MAX_DISTANCE + 10) {
      total += val;
      validCount++;
    }
    delay(30);
  }

  if (validCount == 0)
    return -1;
  return total / validCount;
}

// ==========================================
// 7. LOOP UTAMA (LOGIKA 500kVA + PESAN LAMA)
// ==========================================

void loop() {
  // Pastikan WiFi tetap terhubung (Auto Reconnect Multi WiFi)
  if (wifiMulti.run() != WL_CONNECTED) {
    Serial.println("WiFi Lost... Reconnecting...");
  }

  // 1. Ambil Data Stabil (Smoothing)
  float jarakFloat = getSmoothedDistance();

  // Handling Blind Spot & Error
  if (jarakFloat == -1) {
    delay(1000);
    return;
  }

  if (jarakFloat < 20.0)
    jarakFloat = 0.0;
  unsigned int jarak = (unsigned int)jarakFloat;
  if (jarak > MAX_DISTANCE)
    jarak = MAX_DISTANCE;

  // 2. Hitung Volume Saat Ini
  float currentVolume =
      (90.0 - (float)jarak) * TANGKI_PANJANG * TANGKI_LEBAR * 0.001;
  if (currentVolume < 0)
    currentVolume = 0;

  tinggi = 90 - jarak;

  // Init awal volumeSatuMenitLalu
  if (volumeSatuMenitLalu == 0)
    volumeSatuMenitLalu = currentVolume;

  // --- UPDATE FIREBASE REALTIME (UI) ---
  if (abs(currentVolume - lastSentVolume) >= 0.5) {
    String basePath = "/devices/" + String(DEVICE_ID) + "/data";
    Firebase.setFloat(firebaseData, basePath + "/volume", currentVolume);
    Firebase.setInt(firebaseData, basePath + "/tinggi", tinggi);
    lastSentVolume = currentVolume;
  }

  // ============================================================
  // LOGIKA DETEKSI GENSET (Sistem Sampling 1 Menit)
  // ============================================================

  if (millis() - lastCheckTime > CHECK_INTERVAL) {
    lastCheckTime = millis(); // Reset timer 1 menit

    // Delta positif = Berkurang, Delta negatif = Bertambah
    float delta = volumeSatuMenitLalu - currentVolume;

    Serial.print("Cek 1 Menit -> Delta: ");
    Serial.print(delta);
    Serial.println(" Liter");

    // --- A. LOGIKA PENGISIAN (REFUEL) ---
    if (delta < -5.0 && !isMachineRunning) {
      // Format Pesan LAMA
      String pesan = "⛽ PENGISIAN DETECTED!\n";
      pesan += "Waktu: " + getTimestamp() + "\n";
      pesan += "Awal: " + String(volumeSatuMenitLalu, 1) + " L\n";
      pesan += "Akhir: " + String(currentVolume, 1) + " L\n";
      pesan += "Total Isi: +" + String(abs(delta), 1) + " L";
      bot.sendMessage(CHAT_ID, pesan, "");

      // Update Firebase Logs LAMA
      FirebaseJson jsonLog;
      jsonLog.set("tanggal", getTimestamp());
      jsonLog.set("volume_awal", String(volumeSatuMenitLalu));
      jsonLog.set("volume_akhir", String(currentVolume));
      jsonLog.set("status", "Pengisian");

      String basePath = "/devices/" + String(DEVICE_ID) + "/data";
      Firebase.pushJSON(firebaseData, basePath + "/logs", jsonLog);
      // Hapus last_run jika tidak diperlukan atau ubah pathnya
      // Firebase.setJSON(firebaseData, "/genset/last_run", jsonLog);

      volumeSatuMenitLalu = currentVolume;
      lastVolume = currentVolume;
      return;
    }

    // --- B. LOGIKA DETEKSI START (NYALA) ---
    // Syarat Baru: Turun > 0.8L selama 2 menit berturut-turut
    if (!isMachineRunning) {
      if (delta > 0.8) {
        counterPenurunan++;
      } else {
        counterPenurunan = 0;
      }

      if (counterPenurunan >= 2) {
        isMachineRunning = true;
        startVolume = volumeSatuMenitLalu + delta;
        startTime = millis();
        startTimeStr = getTimestamp();
        lastChangeTime = millis();

        // Format Pesan LAMA
        String pesan = "⚠️ GENSET MENYALA!\n";
        pesan += "Waktu: " + startTimeStr + "\n";
        pesan += "Volume Awal: " + String(startVolume, 1) + " L";
        bot.sendMessage(CHAT_ID, pesan, "");

        Serial.println("STATUS: Mesin Terdeteksi MENYALA...");
        counterPenurunan = 0;
      }
    }

    // --- C. LOGIKA DETEKSI STOP (MATI) ---
    // Syarat Baru: Delta < 0.5L selama 3 menit berturut-turut
    else if (isMachineRunning) {
      if (delta < 0.5) {
        counterDiam++;
      } else {
        counterDiam = 0;
      }

      if (counterDiam >= 3) {
        isMachineRunning = false;

        // Kalkulasi Total (Dikurangi 3 menit waktu tunggu deteksi)
        unsigned long durasiMillis = millis() - startTime - (3 * 60000);
        int durasiMenit = durasiMillis / 60000;
        if (durasiMenit < 0)
          durasiMenit = 0;

        float totalKonsumsi = startVolume - currentVolume;
        if (totalKonsumsi < 0)
          totalKonsumsi = 0;

        // Logika Status LAMA
        String status = (totalKonsumsi > 0 && totalKonsumsi < 200)
                            ? "Normal"
                            : "Check Sensor";
        String stopTimeStr = getTimestamp();

        // 1. UPDATE RIWAYAT
        FirebaseJson jsonHistory;
        jsonHistory.set("tanggal", startTimeStr);

        // Ambil Jam Nyala
        String jamNyala = "00:00";
        if (startTimeStr.length() > 5) {
          jamNyala = startTimeStr.substring(startTimeStr.length() - 5);
        }
        jsonHistory.set("jam_nyala", jamNyala);
        jsonHistory.set("durasi", String(durasiMenit) + " Menit");
        jsonHistory.set("konsumsi_bbm", String(totalKonsumsi, 1) + " L");
        jsonHistory.set("status", status);

        String basePath = "/devices/" + String(DEVICE_ID) + "/data";
        Firebase.pushJSON(firebaseData, basePath + "/history", jsonHistory);

        // 2. UPDATE LOG TERKINI
        FirebaseJson jsonLog;
        jsonLog.set("tanggal", stopTimeStr);
        jsonLog.set("volume_awal", String(startVolume));
        jsonLog.set("volume_akhir", String(currentVolume));
        jsonLog.set("status", "Pemakaian");

        Firebase.pushJSON(firebaseData, basePath + "/logs", jsonLog);
        // Firebase.setJSON(firebaseData, "/genset/last_run", jsonLog);

        // 3. KIRIM TELEGRAM LENGKAP
        String pesan = "✅ GENSET MATI\n";
        pesan += "Waktu: " + stopTimeStr + "\n";
        pesan += "Durasi: " + String(durasiMenit) + " Menit\n";
        pesan += "Konsumsi: " + String(totalKonsumsi, 1) + " L\n";
        pesan += "Sisa BBM: " + String(currentVolume, 1) + " L\n";
        pesan += "Status: " + status;

        bot.sendMessage(CHAT_ID, pesan, "");
        Serial.println("STATUS: Mesin MATI. Laporan terkirim.");

        counterDiam = 0;
      }
    }

    // Update titik acuan
    volumeSatuMenitLalu = currentVolume;

    // Notifikasi Bensin Habis
    float persentase = (currentVolume / MAX_VOLUME_LITER) * 100.0;
    if (persentase <= 20.0 && !isLowFuelNotified) {
      String pesan = "⚠️ PERINGATAN: BENSIN KRITIS!\n";
      pesan += "Waktu: " + getTimestamp() + "\n";
      pesan += "Sisa BBM: " + String(currentVolume, 1) + " L (" +
               String(persentase, 0) + "%)\n";
      pesan += "Segera lakukan pengisian ulang!";
      bot.sendMessage(CHAT_ID, pesan, "");
      isLowFuelNotified = true;
    } else if (persentase > 25.0) {
      isLowFuelNotified = false;
    }
  }

  delay(100);
}