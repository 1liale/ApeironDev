import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ClerkProvider } from '@clerk/react-router'
import { BrowserRouter } from 'react-router-dom'
import { dark } from '@clerk/themes'
import type { Appearance } from '@clerk/types'

// Import your publishable key from environment variables
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY")
}

// Wrapper component to manage Clerk's theme based on localStorage
const ClerkThemeProviderWrapper = ({ children }: { children: React.ReactNode }) => {
  const [baseTheme, setBaseTheme] = useState<Appearance['baseTheme']>(undefined)

  useEffect(() => {
    const applyTheme = () => {
      const savedTheme = localStorage.getItem("theme")
      if (savedTheme === "dark") {
        setBaseTheme(dark)
      } else {
        setBaseTheme(undefined)
      }
    }

    applyTheme()

    // Listen for storage changes to update theme dynamically
    // This handles cases where the theme is changed in another tab
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === "theme") {
        applyTheme()
      }
    }

    window.addEventListener('storage', handleStorageChange)

    // Also, listen for a custom event that HomePage might dispatch when its local state changes
    // This handles same-tab theme changes more reliably if localStorage events are slow or not firing for same tab.
    const handleCustomThemeChange = () => {
      applyTheme()
    }
    window.addEventListener('themeChanged', handleCustomThemeChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('themeChanged', handleCustomThemeChange)
    }
  }, [])

  return (
    <ClerkProvider 
      publishableKey={PUBLISHABLE_KEY}
      appearance={{
        baseTheme: baseTheme,
      }}
    >
      {children}
    </ClerkProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClerkThemeProviderWrapper>
        <App />
      </ClerkThemeProviderWrapper>
    </BrowserRouter>
  </React.StrictMode>,
)
