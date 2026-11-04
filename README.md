# Monitoring PLTS Hybrid

Repository ini berisi source aplikasi monitoring hybrid solar, konfigurasi
deployment, pengujian, dan demo visual statis.

## GitHub Pages application demo

GitHub Pages menjalankan seluruh layar antarmuka web menggunakan data contoh
sintetis yang dibuat di browser. Workflow membangun dashboard dari source
`web/` dan menerbitkan hasil statis di [`github-pages-app/site/`](./github-pages-app/site/).
[`github-pages-demo/`](./github-pages-demo/) tetap tersedia sebagai ringkasan
visual mandiri.

Demo: https://monitoringpltspelalawan-dotcom.github.io/Monitoring-PLTS-Hybrid/

Filter dan navigasi layar bekerja di browser. GitHub Pages tidak menjalankan
backend, autentikasi sungguhan, database, MQTT, koneksi perangkat, atau
telemetry live; tindakan administratif hanya simulasi lokal. Jangan gunakan
sebagai sistem operasional atau untuk keputusan keselamatan.

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
di-deploy. GitHub Pages hanya berisi antarmuka statis dengan data sintetis; layanan backend, PostgreSQL,
MQTT/TLS, domain, dan telemetry nyata belum dinyatakan live.
