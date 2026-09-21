/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_DEFAULT_ANALYSIS_TIME_MS?: string
  readonly VITE_ANALYSIS_DEPTH_CEILING?: string
  readonly VITE_DEFAULT_REVIEW_DEPTH?: string
  readonly VITE_DEFAULT_REVIEW_MULTIPV?: string
  readonly VITE_EXPORT_FEEDBACK_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
