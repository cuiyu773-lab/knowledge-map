import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import 'katex/dist/katex.min.css'
import '@renderer/styles/global.css'
import { App } from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
