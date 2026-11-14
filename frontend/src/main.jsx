import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './screens.css'
import './theme.css'

// This app navigates between views with React state rather than browser history.
// Keep browser restoration from reopening the single app document at a stale offset.
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
