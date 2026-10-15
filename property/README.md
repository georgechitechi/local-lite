# Property Admin 🏠

A professional, local-first property management solution. Designed to help property owners and administrators manage tenants, contracts, and financial records efficiently.

<details open>
<summary><b>Bring Your Own Database Setup</b></summary>
<br>
Property Admin allows you to connect your own Supabase instance to retain complete ownership of your data.

1. **Open the App**: Launch the application on your device.
2. **Navigate to Settings**: Tap the cloud icon or go to **Settings > Cloud Sync**.
3. **Configure Sync**: Enable Cloud Sync and enter your **Supabase Project URL** and **Anon Key**.
   - *Alternatively, you can paste a "Connection Key" if you have one.*
4. **Connect**: Tap connect, and the application will synchronize all your local offline data with your own cloud database.
</details>

## ✨ Key Features

- **Dashboard Insights**: High-level financial summaries and maintenance overviews.
- **Tenant Management**: Comprehensive tenant profiles with payment history and contact details.
- **Contract Management**: Modernized agreement tracking with dynamic lease progress and automated PDF generation.
- **Financial Tracking**: Robust receipt generation and payment history management.
- **Maintenance Tracking**: Streamlined maintenance request handling and status monitoring.
- **Audit Logs**: Detailed history tracking for all critical data changes.
- **Local-First Architecture**: Seamless offline-first experience with reactive data synchronization.

## 🛠 Getting Started

### 1. Prerequisites

- Node.js (v20+)
- Expo CLI
- EAS CLI (for builds and updates)

### 2. Installation

```bash
npm install
```

### 3. Running Locally

```bash
# Start the development server
npm run dev
```

### 4. Development Workflow

- **Format Code**: `npm run format`
- **Linting**: `npm run lint`

## 📦 Deployment & CI/CD

This project uses **EAS (Expo Application Services)** for cloud builds and OTA updates.

### Manual Preview Updates

You can deploy updates to the `preview` channel directly from GitHub Actions using the "Preview Update" workflow.

```bash
# Manual command equivalent
npm run update:preview
```

## 🔒 Security & Privacy

- **Encrypted Storage**: Sensitive credentials are managed via Expo SecureStore.
- **Privacy Policy**: Integrated privacy compliance for data handling.
- **Access Control**: Role-based access within the application modules.

---

_Built with ❤️ for modern property management._
