import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { initTheme } from './lib/theme.ts'

initTheme()

// Android hardware back button: navigate back in-app, exit at the root.
if (Capacitor.isNativePlatform()) {
  void NativeApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back()
    else void NativeApp.exitApp()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
