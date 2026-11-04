# Monitoring PLTS Hybrid

Repository ini berisi source aplikasi monitoring hybrid solar, konfigurasi
deployment, pengujian, dan demo visual statis.

## GitHub Pages demo

Demo di [`github-pages-demo/`](./github-pages-demo/) menggunakan data contoh
sintetis. GitHub Pages hanya menyajikan file statis; demo tidak menjalankan
backend, autentikasi, database, MQTT, atau telemetry live. Jangan gunakan
sebagai sistem operasional atau untuk keputusan keselamatan.

Demo: https://monitoringpltspelalawan-dotcom.github.io/Monitoring-PLTS-Hybrid/

## Menjalankan aplikasi lokal

Memerlukan Node.js sesuai versi di `package.json`.

```sh
npm ci
npm run seed
npm run dev
```

Default akun dan data demo hanya untuk pengembangan/evaluasi lokal. Jangan
gunakan kredensial demo untuk sistem produksi. Lihat
[`deployment/DEPLOYMENT.md`](./deployment/DEPLOYMENT.md) untuk persiapan VPS.

## Keamanan dan status deployment

Jangan commit `.env`, database, token gateway, sertifikat, private key, backup,
atau data operasional. Aturan `.gitignore` mengecualikan lokasi data lokal dan
file rahasia umum; tetap tinjau file yang akan di-commit.

Source dan konfigurasi deployment di repository bukan bukti aplikasi telah
di-deploy. GitHub Pages hanya berisi demo statis; layanan backend, PostgreSQL,
MQTT/TLS, domain, dan telemetry nyata belum dinyatakan live.
