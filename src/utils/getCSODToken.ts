import fetch from 'node-fetch'
import 'dotenv/config'
import {
  CSOD_API_HOST,
  CSOD_API_CLIENT_ID,
  CSOD_API_CLIENT_SECRET,
} from './env'

export interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

const getOauthToken = async () =>
  fetch(`${CSOD_API_HOST}/oauth2/token`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    body: JSON.stringify({
      clientId: CSOD_API_CLIENT_ID,
      clientSecret: CSOD_API_CLIENT_SECRET,
      grantType: 'client_credentials',
      scope: 'all',
    }),
  })

const fetchAPIToken = async () => {
  const tokenResponse = await getOauthToken()
  const { token_type, access_token } =
    (await tokenResponse.json()) as TokenResponse
  return `${token_type} ${access_token}`
}

const apiToken = (() => {
  let token: string
  let expiration: Date

  return {
    async get() {
      const now = new Date()
      if (!token || !expiration || now > expiration) {
        token = await fetchAPIToken()
        expiration = new Date()
        expiration.setSeconds(expiration.getSeconds() + 15)
      }
      return token
    },
  }
})()

export default apiToken.get
