import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const app = express()
const PORT = process.env.PORT || 3000

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

async function getAccessToken() {
  const params = new URLSearchParams()

  params.append('client_id', process.env.GOOGLE_ADS_CLIENT_ID)
  params.append('client_secret', process.env.GOOGLE_ADS_CLIENT_SECRET)
  params.append('refresh_token', process.env.GOOGLE_ADS_REFRESH_TOKEN)
  params.append('grant_type', 'refresh_token')

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(JSON.stringify(data))
  }

  return data.access_token
}

async function fetchGoogleAdsCampaigns90Days() {
  const accessToken = await getAccessToken()

  const query = `
    SELECT
      segments.date,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr
    FROM campaign
    WHERE segments.date DURING LAST_90_DAYS
    ORDER BY segments.date DESC
  `

  const response = await fetch(
    `https://googleads.googleapis.com/v24/customers/${process.env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query
      })
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(JSON.stringify(data))
  }

  return data.results || []
}

app.get('/', (req, res) => {
  res.send('Google Ads AI Server Running')
})

app.get('/google-ads', async (req, res) => {
  try {
    const results = await fetchGoogleAdsCampaigns90Days()

    res.json({
      count: results.length,
      results
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})

app.get('/sync-google-ads', async (req, res) => {
  try {
    const results = await fetchGoogleAdsCampaigns90Days()

    const rows = results.map((item) => ({
      campaign_name: item.campaign.name,
      clicks: Number(item.metrics.clicks || 0),
      impressions: Number(item.metrics.impressions || 0),
      ctr: Number(item.metrics.ctr || 0),
      cost: 0,
      conversions: 0,
      report_date: item.segments.date
    }))

    const { data, error } = await supabase
      .from('campaign_reports')
      .insert(rows)
      .select()

    if (error) {
      throw error
    }

    res.json({
      message: '90 days Google Ads data synced',
      inserted: data.length
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})

app.get('/analyze-google-ads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(300)

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告運用の専門家です。

以下は過去90日間の日別Google広告データです。

分析してください。

分析内容:
1. CTR推移
2. 悪化傾向
3. 改善傾向
4. キャンペーン比較
5. 今後の改善施策
6. 経営者向け要約

データ:
${JSON.stringify(data, null, 2)}
`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    res.json({
      analysis: completion.choices[0].message.content
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`)
})
