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

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  })

  const data = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(data))
  return data.access_token
}

async function fetchGoogleAdsCampaigns() {
  const accessToken = await getAccessToken()

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr
    FROM campaign
    LIMIT 10
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
      body: JSON.stringify({ query })
    }
  )

  const data = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(data))
  return data.results || []
}

app.get('/', (req, res) => {
  res.send('Google Ads AI Server Running')
})

app.get('/google-ads', async (req, res) => {
  try {
    const results = await fetchGoogleAdsCampaigns()
    res.json({ results })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/sync-google-ads', async (req, res) => {
  try {
    const results = await fetchGoogleAdsCampaigns()

    const rows = results.map((item) => ({
      campaign_name: item.campaign.name,
      clicks: Number(item.metrics.clicks || 0),
      impressions: Number(item.metrics.impressions || 0),
      ctr: Number(item.metrics.ctr || 0),
      cost: 0,
      conversions: 0,
      report_date: new Date().toISOString().slice(0, 10)
    }))

    const { data, error } = await supabase
      .from('campaign_reports')
      .insert(rows)
      .select()

    if (error) throw error

    res.json({
      message: 'Google Ads data synced to Supabase',
      count: data.length,
      data
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/analyze-google-ads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('id', { ascending: false })
      .limit(20)

    if (error) throw error

    const prompt = `
あなたはGoogle広告運用の専門家です。
以下のGoogle広告キャンペーンデータを分析してください。

分析してほしい内容：
1. 良いキャンペーン
2. 改善が必要なキャンペーン
3. CTRの比較
4. クリック数と表示回数から見た改善案
5. 次にやるべき具体的な施策
6. 経営者向けの短いまとめ

広告データ：
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
      message: 'Google Ads analysis completed',
      analysis: completion.choices[0].message.content,
      data
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`)
})
