# Monitoring PLTS Hybrid

## Demo visual (data sintetis)

Demo dashboard statis untuk melihat tampilan Monitoring PLTS Hybrid. Nilai yang ditampilkan adalah data contoh/sintetis dan tidak berasal dari pembangkit, gateway, atau telemetry nyata.

- Demo GitHub Pages: https://monitoringpltspelalawan-dotcom.github.io/Monitoring-PLTS-Hybrid/ (tersedia setelah Pages diaktifkan dan workflow deployment berhasil).
- Sumber demo: [`github-pages-demo/`](./github-pages-demo/)

### Batasan

GitHub Pages hanya menyajikan file statis. Demo ini tidak menyediakan autentikasi, API/backend, database, MQTT, kontrol perangkat, maupun telemetry live. Jangan gunakan sebagai sistem operasional atau untuk keputusan keselamatan.

### Menjalankan lokal

Buka [`github-pages-demo/index.html`](./github-pages-demo/index.html) di browser.

Untuk deployment full-stack, termasuk PostgreSQL, HTTPS, dan MQTT TLS, lihat [`deployment/DEPLOYMENT.md`](./deployment/DEPLOYMENT.md). Deployment VPS memerlukan server dan konfigurasi domain/secrets sendiri; belum termasuk dalam demo Pages ini.
