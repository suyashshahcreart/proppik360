// ============================================================
// API client â€” typed fetch wrapper for all Worker API calls
//
// All requests include credentials: 'include' so the session
// cookie is automatically sent with cross-origin requests
// (Vite dev server â†’ Worker on port 8787).
//
// On a 401 response, the user is redirected to /login.
// ============================================================
import type {
  User,
  Tour,
  TourDetailsInput,
  TourUploadHistoryEntry,
  DashboardStats,
  Customer,
  CustomerWithLinks,
  CustomerToursResponse,
  CustomerInput,
  Permission,
  Role,
  AdminUser,
  MediaListItem,
  MediaUploadResult,
  MediaCollection,
  MediaEntityType,
  PropertyCategory,
  PropertyCategoryTreeNode,
  PropertyCategoryInput,
  SettingsMap,
  TourAdminMaster,
  TourAdminMasterTemplate,
  TourAdmin,
  TourAdminListResponse,
} from '../types'

/** NDJSON progress events from DELETE /api/tours/:id */
export interface TourDeleteProgress {
  stage: 'soft_delete' | 'listing' | 'deleting' | 'done' | 'error'
  percent: number
  filesDeleted: number
  filesTotal: number
  elapsedMs: number
  message?: string
  r2Warning?: string | null
}

/** API failure that can point at a form field. */
export class ApiError extends Error {
  field?: string
  constructor(message: string, field?: string) {
    super(message)
    this.name = 'ApiError'
    this.field = field
  }
}

/**
 * Base fetch helper. Throws an Error with the API error message on failure.
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = await response.json()

  if (!data.success) {
    if (response.status === 401 && window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
    const field =
      data.error?.details && typeof data.error.details.field === 'string'
        ? data.error.details.field
        : undefined
    throw new ApiError(data.error?.message ?? 'Request failed', field)
  }

  return data.data as T
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    logout: () =>
      request<{ message: string }>('/auth/logout', { method: 'POST' }),

    me: () =>
      request<User>('/auth/me', { signal: AbortSignal.timeout(8000) }),
  },

  dashboard: {
    stats: () =>
      request<DashboardStats>('/dashboard/stats', { signal: AbortSignal.timeout(15000) }),
  },

  tours: {
    list: () => request<Tour[]>('/tours'),

    create: (name: string, details?: Omit<TourDetailsInput, 'name'>) =>
      request<Tour>('/tours', {
        method: 'POST',
        body: JSON.stringify(details ? { name, ...details } : { name }),
      }),

    update: (id: string, payload: TourDetailsInput) =>
      request<Tour>(`/tours/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),

    formOptions: () =>
      request<{
        customers: Array<{ id: string; name: string; company_name: string | null }>
        categories: PropertyCategoryTreeNode[]
      }>('/tours/form-options'),

    get: (id: string) => request<Tour>(`/tours/${id}`),

    tourAdmin: {
      get: (tourId: string) => request<TourAdminListResponse>(`/tours/${tourId}/tour-admin`),
      put: (
        tourId: string,
        payload: {
          id?: string
          username: string
          password?: string | null
          country_code?: string
          mobile?: string | null
          password_enabled?: boolean
          otp_enabled?: boolean
          is_active?: boolean
        },
      ) =>
        request<TourAdmin>(`/tours/${tourId}/tour-admin`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (tourId: string, adminId: string) =>
        request<{ message: string }>(`/tours/${tourId}/tour-admin/${adminId}`, {
          method: 'DELETE',
        }),
      resetPassword: (tourId: string, password?: string | null, adminId?: string) =>
        request<{ admin: TourAdmin; generated_password?: string }>(
          `/tours/${tourId}/tour-admin/reset-password`,
          {
            method: 'POST',
            body: JSON.stringify({ password: password ?? null, id: adminId }),
          },
        ),
    },

    /** Per-ZIP upload / processing history (all attempts). */
    history: (id: string) =>
      request<{ tourId: string; history: TourUploadHistoryEntry[] }>(`/tours/${id}/history`),

    /** Probe Go processor liveness (Worker → PROCESSOR_WEBHOOK_URL /health). */
    processorStatus: () =>
      request<{
        online: boolean
        latencyMs: number | null
        error: string | null
        checkedAt: string | null
        attempts: number
        healthUrl: string | null
        webhookConfigured: boolean
      }>('/tours/processor-status'),

    /**
     * Resume a stuck tour: heal uploading+ZIP, re-dispatch processing,
     * or mark incomplete uploads as failed.
     */
    resume: (id: string) =>
      request<{
        action: {
          tourId: string
          action: string
          detail?: string
        }
        tour: Tour | null
      }>(`/tours/${id}/resume`, { method: 'POST' }),

    /**
     * Delete a tour and stream NDJSON progress events.
     * Falls back to a single JSON response if the worker returns application/json.
     */
    delete: async (
      id: string,
      onProgress?: (progress: TourDeleteProgress) => void,
    ): Promise<{ message: string; filesDeleted: number; r2Warning?: string | null }> => {
      const response = await fetch(`/api/tours/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      const contentType = response.headers.get('content-type') ?? ''

      // Non-streaming error / legacy JSON response
      if (contentType.includes('application/json')) {
        const data = await response.json()
        if (!data.success) {
          if (response.status === 401 && window.location.pathname !== '/login') {
            window.location.href = '/login'
          }
          throw new Error(data.error?.message ?? 'Delete failed')
        }
        return data.data as {
          message: string
          filesDeleted: number
          r2Warning?: string | null
        }
      }

      if (!response.ok || !response.body) {
        throw new Error(`Delete failed (HTTP ${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let result: {
        message: string
        filesDeleted: number
        r2Warning?: string | null
      } = { message: 'Tour deleted', filesDeleted: 0 }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          let event: TourDeleteProgress
          try {
            event = JSON.parse(trimmed) as TourDeleteProgress
          } catch {
            continue
          }

          if (event.stage === 'error') {
            throw new Error(event.message ?? 'Delete failed')
          }

          onProgress?.(event)

          if (event.stage === 'done') {
            result = {
              message: event.message ?? 'Tour deleted',
              filesDeleted: event.filesDeleted,
              r2Warning: event.r2Warning,
            }
          }
        }
      }

      return result
    },

    /** Upload a media file for a specific tour collection (thumbnail, logo, assets) */
    uploadMedia: async (
      tourId: string,
      collection: MediaCollection,
      file: File,
      onProgress?: (pct: number) => void,
    ): Promise<MediaUploadResult> => {
      const form = new FormData()
      form.append('collection', collection)
      form.append('file', file)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/tours/${tourId}/media`)
        xhr.withCredentials = true

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
        }

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (!data.success) {
              if (xhr.status === 401 && window.location.pathname !== '/login') {
                window.location.href = '/login'
              }
              reject(new Error(data.error?.message ?? 'Media upload failed'))
            } else {
              resolve(data.data as MediaUploadResult)
            }
          } catch {
            reject(new Error('Invalid response from server'))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(form)
      })
    },
  },

  uploads: {
    initiate: (
      tourId: string,
      payload: { filename: string; fileSize: number; forceReupload?: boolean },
    ) =>
      request<{
        uploadId: string
        r2Key: string
        partSizeBytes: number
        totalParts: number
      }>(`/tours/${tourId}/upload/initiate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    partUrl: (
      tourId: string,
      payload: { partNumber: number; uploadId: string },
    ) =>
      request<{ presignedUrl: string }>(`/tours/${tourId}/upload/part-url`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    complete: (
      tourId: string,
      payload: {
        uploadId: string
        parts: Array<{ PartNumber: number; ETag: string }>
      },
    ) =>
      request<{ message: string; processorDispatched?: boolean; processorError?: string }>(`/tours/${tourId}/upload/complete`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    abort: (tourId: string, uploadId: string) =>
      request<{ message: string }>(`/tours/${tourId}/upload/abort`, {
        method: 'POST',
        body: JSON.stringify({ uploadId }),
      }),

    listParts: (tourId: string, uploadId: string) =>
      request<{ parts: Array<{ PartNumber: number; ETag: string; Size?: number }> }>(
        `/tours/${tourId}/upload/list-parts`,
        {
          method: 'POST',
          body: JSON.stringify({ uploadId }),
        },
      ),
  },

  /** Tour admin (and future) artifact ZIP ingest — does not change tours.status. */
  artifacts: {
    tourAdmin: {
      initiate: (
        tourId: string,
        payload: { filename: string; fileSize: number; saveBackupZip?: boolean },
      ) =>
        request<{
          sessionId: string
          chunkSizeBytes: number
          totalChunks: number
          backupVersion: string
          artifactType: string
        }>(`/tours/${tourId}/artifacts/tour_admin/ingest/initiate`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),

      status: (tourId: string) =>
        request<{
          sessionId: string | null
          bytesReceived: number
          fileSize?: number
          chunkSize?: number
          receivedChunks: number[]
          missingChunks: number[]
          assembled: boolean
          totalChunks?: number
          artifactStatus?: string | null
          publishUrl?: string | null
        }>(`/tours/${tourId}/artifacts/tour_admin/ingest/status`),

      complete: (tourId: string) =>
        request<{ message: string; assembled?: boolean; enqueued?: boolean }>(
          `/tours/${tourId}/artifacts/tour_admin/ingest/complete`,
          { method: 'POST' },
        ),

      abort: (tourId: string) =>
        request<{ message: string }>(`/tours/${tourId}/artifacts/tour_admin/ingest/abort`, {
          method: 'POST',
        }),

      history: (tourId: string) =>
        request<{
          tourId: string
          artifactType: string
          history: TourUploadHistoryEntry[]
        }>(`/tours/${tourId}/artifacts/tour_admin/history`),

      publishInfo: (tourId: string) =>
        request<{
          tourId: string
          artifactType: string
          publishUrl: string | null
          status: string | null
          lastSuccessAt: string | null
          lastUploadAt: string | null
          backupKey: string | null
          backupVersion: string | null
          publicDomain: string | null
        }>(`/tours/${tourId}/artifacts/tour_admin/publish-info`),

      putChunk: (
        tourId: string,
        sessionId: string,
        chunkNumber: number,
        chunk: Blob,
        onBytes?: (loaded: number) => void,
        signal?: AbortSignal,
      ): Promise<{ bytesReceived: number; receivedChunks: number[] }> =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', `/api/tours/${tourId}/artifacts/tour_admin/ingest/chunk`)
          xhr.withCredentials = true
          xhr.setRequestHeader('Content-Type', 'application/octet-stream')
          xhr.setRequestHeader('X-Session-Id', sessionId)
          xhr.setRequestHeader('X-Chunk-Number', String(chunkNumber))

          const fail = (message: string) => reject(new Error(message))

          if (signal) {
            if (signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            signal.addEventListener('abort', () => xhr.abort(), { once: true })
          }

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) onBytes?.(event.loaded)
          }
          xhr.onerror = () => fail(`Network error uploading chunk ${chunkNumber}`)
          xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
          xhr.onload = () => {
            let data: {
              success?: boolean
              error?: { message?: string }
              data?: { bytesReceived: number; receivedChunks: number[] }
            } | null = null
            try {
              data = JSON.parse(xhr.responseText) as {
                success?: boolean
                error?: { message?: string }
                data?: { bytesReceived: number; receivedChunks: number[] }
              }
            } catch {
              /* ignore */
            }
            if (xhr.status >= 200 && xhr.status < 300 && data?.success && data.data) {
              resolve(data.data)
              return
            }
            fail(data?.error?.message ?? `Chunk ${chunkNumber} failed (HTTP ${xhr.status})`)
          }
          xhr.send(chunk)
        }),
    },
  },

  /** Go-first chunked ingest (primary upload path). */
  ingest: {
    initiate: (
      tourId: string,
      payload: { filename: string; fileSize: number; saveBackupZip?: boolean },
    ) =>
      request<{
        sessionId: string
        chunkSizeBytes: number
        totalChunks: number
        backupVersion: string
      }>(`/tours/${tourId}/ingest/initiate`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    status: (tourId: string) =>
      request<{
        sessionId: string | null
        bytesReceived: number
        fileSize?: number
        chunkSize?: number
        receivedChunks: number[]
        missingChunks: number[]
        assembled: boolean
        totalChunks?: number
      }>(`/tours/${tourId}/ingest/status`),

    complete: (tourId: string) =>
      request<{ message: string; assembled?: boolean; enqueued?: boolean }>(
        `/tours/${tourId}/ingest/complete`,
        { method: 'POST' },
      ),

    abort: (tourId: string) =>
      request<{ message: string }>(`/tours/${tourId}/ingest/abort`, { method: 'POST' }),

    putChunk: (
      tourId: string,
      sessionId: string,
      chunkNumber: number,
      chunk: Blob,
      onBytes?: (loaded: number) => void,
      signal?: AbortSignal,
    ): Promise<{ bytesReceived: number; receivedChunks: number[] }> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', `/api/tours/${tourId}/ingest/chunk`)
        xhr.withCredentials = true
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('X-Session-Id', sessionId)
        xhr.setRequestHeader('X-Chunk-Number', String(chunkNumber))

        const fail = (message: string) => reject(new Error(message))

        if (signal) {
          if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal.addEventListener('abort', () => xhr.abort(), { once: true })
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) onBytes?.(event.loaded)
        }
        xhr.onerror = () => fail(`Network error uploading chunk ${chunkNumber}`)
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        xhr.onload = () => {
          let data: {
            success?: boolean
            error?: { message?: string }
            data?: { bytesReceived: number; receivedChunks: number[] }
          } | null = null
          try {
            data = JSON.parse(xhr.responseText) as {
              success?: boolean
              error?: { message?: string }
              data?: { bytesReceived: number; receivedChunks: number[] }
            }
          } catch {
            data = null
          }
          if (xhr.status >= 200 && xhr.status < 300 && data?.success && data.data) {
            resolve(data.data)
            return
          }
          fail(data?.error?.message ?? `Chunk ${chunkNumber} failed (HTTP ${xhr.status})`)
        }
        xhr.send(chunk)
      }),
  },


  system: {
    // ── Permissions ──────────────────────────────────────────
    permissions: {
      list: () => request<Permission[]>('/system/permissions'),
      get: (id: string) => request<Permission>(`/system/permissions/${id}`),
      create: (name: string) =>
        request<Permission>('/system/permissions', {
          method: 'POST',
          body: JSON.stringify({ name }),
        }),
      update: (id: string, name: string) =>
        request<Permission>(`/system/permissions/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name }),
        }),
      delete: (id: string) =>
        request<{ message: string }>(`/system/permissions/${id}`, {
          method: 'DELETE',
        }),
    },

    // ── Roles ────────────────────────────────────────────────
    roles: {
      list: () => request<Role[]>('/system/roles'),
      get: (id: string) => request<Role>(`/system/roles/${id}`),
      create: (name: string, permissionIds: string[]) =>
        request<Role>('/system/roles', {
          method: 'POST',
          body: JSON.stringify({ name, permission_ids: permissionIds }),
        }),
      update: (id: string, name: string, permissionIds: string[]) =>
        request<Role>(`/system/roles/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, permission_ids: permissionIds }),
        }),
      delete: (id: string) =>
        request<{ message: string }>(`/system/roles/${id}`, {
          method: 'DELETE',
        }),
    },

    // ── Admin Users ──────────────────────────────────────────
    users: {
      list: () => request<AdminUser[]>('/system/users'),
      get: (id: string) => request<AdminUser>(`/system/users/${id}`),
      create: (payload: {
        name: string
        email: string
        password: string
        status: 'active' | 'suspended'
        role_ids: string[]
      }) =>
        request<AdminUser>('/system/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (
        id: string,
        payload: {
          name?: string
          email?: string
          password?: string
          status?: 'active' | 'suspended'
          role_ids?: string[]
        },
      ) =>
        request<AdminUser>(`/system/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<{ message: string }>(`/system/users/${id}`, {
          method: 'DELETE',
        }),
    },

    // ── Platform settings ────────────────────────────────────
    settings: {
      get: () => request<SettingsMap>('/system/settings'),
      patch: (payload: Record<string, unknown> & { tab: 'general' | 'sms' }) =>
        request<SettingsMap>('/system/settings', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
    },

    tourAdminMaster: {
      get: () => request<TourAdminMaster>('/system/tour-admin-master'),
      put: (payload: {
        auto_create_on_tour_create?: boolean
        password_enabled_default?: boolean
        otp_enabled_default?: boolean
        default_username_pattern?: string
        password_mode?: 'random' | 'fixed'
        default_password?: string | null
        default_country_code?: string
        default_mobile?: string | null
        is_active_default?: boolean
      }) =>
        request<TourAdminMaster>('/system/tour-admin-master', {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      templates: {
        list: () =>
          request<TourAdminMasterTemplate[]>('/system/tour-admin-master/templates'),
        get: (id: string) =>
          request<TourAdminMasterTemplate>(`/system/tour-admin-master/templates/${id}`),
        create: (payload: {
          label: string
          username_pattern: string
          password_mode: 'random' | 'fixed'
          password?: string | null
          country_code?: string
          mobile?: string | null
          password_enabled?: boolean
          otp_enabled?: boolean
          is_active?: boolean
          sort_order?: number
        }) =>
          request<TourAdminMasterTemplate>('/system/tour-admin-master/templates', {
            method: 'POST',
            body: JSON.stringify(payload),
          }),
        update: (
          id: string,
          payload: {
            label: string
            username_pattern: string
            password_mode: 'random' | 'fixed'
            password?: string | null
            country_code?: string
            mobile?: string | null
            password_enabled?: boolean
            otp_enabled?: boolean
            is_active?: boolean
            sort_order?: number
          },
        ) =>
          request<TourAdminMasterTemplate>(`/system/tour-admin-master/templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          }),
        delete: (id: string) =>
          request<{ message: string }>(`/system/tour-admin-master/templates/${id}`, {
            method: 'DELETE',
          }),
      },
    },

    // ── Property classification masters (recursive) ──────────
    propertyCategories: {
      tree: () => request<PropertyCategoryTreeNode[]>('/system/property-categories/tree'),
      list: (parentId?: string | null) => {
        const q =
          parentId === undefined
            ? ''
            : `?parent_id=${parentId === null ? '' : encodeURIComponent(parentId)}`
        return request<PropertyCategory[]>(`/system/property-categories${q}`)
      },
      get: (id: string) => request<PropertyCategory>(`/system/property-categories/${id}`),
      create: (payload: PropertyCategoryInput) =>
        request<PropertyCategory>('/system/property-categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      update: (id: string, payload: PropertyCategoryInput) =>
        request<PropertyCategory>(`/system/property-categories/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        }),
      delete: (id: string) =>
        request<{ message: string }>(`/system/property-categories/${id}`, {
          method: 'DELETE',
        }),
    },
  },

  customers: {
    list: () => request<Customer[]>('/customers'),

    get: (id: string) => request<CustomerWithLinks>(`/customers/${id}`),

    /** Customer profile + that customer's tours and status stats. */
    tours: (id: string) => request<CustomerToursResponse>(`/customers/${id}/tours`),

    create: (payload: CustomerInput) =>
      request<CustomerWithLinks>('/customers', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    update: (id: string, payload: CustomerInput) =>
      request<CustomerWithLinks>(`/customers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),

    delete: (id: string) =>
      request<{ message: string }>(`/customers/${id}`, { method: 'DELETE' }),

    uploadPhotos: async (
      id: string,
      files: { profile?: File | null; cover?: File | null },
    ): Promise<CustomerWithLinks> => {
      const form = new FormData()
      if (files.profile) form.append('profile_photo', files.profile)
      if (files.cover) form.append('cover_photo', files.cover)

      const response = await fetch(`/api/customers/${id}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })

      const data = await response.json()
      if (!data.success) {
        if (response.status === 401 && window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
        throw new Error(data.error?.message ?? 'Photo upload failed')
      }
      return data.data as CustomerWithLinks
    },

    /** Upload a media file for a specific customer collection (e.g. customer_seo) */
    uploadMedia: async (
      id: string,
      collection: MediaCollection,
      file: File,
      onProgress?: (pct: number) => void,
    ): Promise<MediaUploadResult> => {
      const form = new FormData()
      form.append('collection', collection)
      form.append('file', file)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `/api/customers/${id}/media`)
        xhr.withCredentials = true

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
        }

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (!data.success) {
              if (xhr.status === 401 && window.location.pathname !== '/login') {
                window.location.href = '/login'
              }
              reject(new Error(data.error?.message ?? 'Media upload failed'))
            } else {
              resolve(data.data as MediaUploadResult)
            }
          } catch {
            reject(new Error('Invalid response from server'))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(form)
      })
    },
  },

  media: {
    list: (params?: {
      collection?: MediaCollection
      mime?: string
      entity_type?: MediaEntityType
      entity_id?: string
      search?: string
      page?: number
      per_page?: number
    }) => {
      const qs = params
        ? '?' +
          Object.entries(params)
            .filter(([, v]) => v != null && v !== '')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&')
        : ''
      return request<{ items: MediaListItem[]; total: number }>(`/system/media${qs}`)
    },

    get: (id: string) => request<MediaListItem>(`/system/media/${id}`),

    /** Upload a new media file, optionally linking it immediately */
    upload: async (
      file: File,
      meta?: {
        collection?: MediaCollection
        entity_type?: MediaEntityType
        entity_id?: string
      },
      onProgress?: (pct: number) => void,
    ): Promise<MediaListItem> => {
      const form = new FormData()
      form.append('file', file)
      if (meta?.collection)   form.append('collection', meta.collection)
      if (meta?.entity_type)  form.append('entity_type', meta.entity_type)
      if (meta?.entity_id)    form.append('entity_id', meta.entity_id)

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/system/media')
        xhr.withCredentials = true

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100))
        }

        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText)
            if (!data.success) {
              if (xhr.status === 401 && window.location.pathname !== '/login') {
                window.location.href = '/login'
              }
              reject(new Error(data.error?.message ?? 'Upload failed'))
            } else {
              resolve(data.data as MediaListItem)
            }
          } catch {
            reject(new Error('Invalid response from server'))
          }
        }

        xhr.onerror = () => reject(new Error('Network error during upload'))
        xhr.send(form)
      })
    },

    delete: (id: string) =>
      request<{ id: string; deleted: boolean }>(`/system/media/${id}`, { method: 'DELETE' }),

    link: (
      mediaId: string,
      payload: {
        entity_type: MediaEntityType
        entity_id: string
        collection: MediaCollection
        sort?: number
        meta_json?: string | null
      },
    ) =>
      request<MediaListItem>(`/system/media/${mediaId}/link`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    unlink: (linkId: string) =>
      request<{ id: string; deleted: boolean; orphaned: boolean }>(`/system/media/media-links/${linkId}`, {
        method: 'DELETE',
      }),
  },

}