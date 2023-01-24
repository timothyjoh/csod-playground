import fetch from 'node-fetch'
import 'dotenv/config'

const CSOD_API_HOST = process.env.CSOD_API_HOST
const CLIENT_ID = process.env.CSOD_API_CLIENT_ID
const CLIENT_SECRET = process.env.CSOD_API_CLIENT_SECRET

interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
}

const getOauthToken = async () => fetch(`${CSOD_API_HOST}/oauth2/token`, {
  headers: {
    "Content-Type": "application/json"
  },
  method: "POST",
  body: JSON.stringify({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    grantType: 'client_credentials',
    scope: 'all',
  })
})

export const getAPIToken = async () => {
  const tokenResponse = await getOauthToken()
  const { token_type, access_token } = await tokenResponse.json() as TokenResponse
  console.log({ token_type, access_token })
  return `${token_type} ${access_token}`
}