import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import OpenAI from 'openai'
import { GoogleAdsApi } from 'google-ads-api'

const app = express()
const PORT = process.env.PORT || 3000

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
})

const customer = client.Customer({
  customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
})

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

app.get('/', (req, res) => {
  res.send('Google Ads AI Server Running')
})

app.get('/env-check', (req, res) => {
  res.json({
    GOOGLE_ADS_CLIENT_ID: !!process.env.GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET: !!process.env.GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_DEVELOPER_TOKEN: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_REFRESH_TOKEN: !!process.env.GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    GOOGLE_ADS_CUSTOMER_ID: process.env.GOOGLE_ADS_CUSTOMER_ID,
  })
})

app.get('/google-ads', async (req, res) => {
  try {
    const campaigns = await customer.query(`
      SELECT
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr
      FROM campaign
      LIMIT 10
    `)

    res.json(campaigns)
  } catch (error) {
    console.error('GOOGLE ADS ERROR FULL:', error)

    res.status(500).json({
      message: 'Google Ads API error',
      error_message: error.message,
      error_name: error.name,
      error_code: error.code,
      raw_error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`)
})
