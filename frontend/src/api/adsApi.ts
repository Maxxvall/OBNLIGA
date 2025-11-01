import type { PublicAdBanner } from '@shared/types'
import { httpRequest, type ApiResponse } from './httpClient'

class AdsApi {
  async fetchAds(version?: string): Promise<ApiResponse<PublicAdBanner[]>> {
    if (version) {
      return httpRequest<PublicAdBanner[]>('/api/ads', { version })
    }
    return httpRequest<PublicAdBanner[]>('/api/ads')
  }
}

export const adsApi = new AdsApi()
