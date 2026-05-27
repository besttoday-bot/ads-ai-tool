import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const app = express()

app.use(express.json())

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
    WHERE segments.date BETWEEN '2026-02-22' AND '2026-05-22'
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
      .limit(80)

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

app.get('/trend-analysis', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告のプロマーケターです。

以下は90日分の日別広告データです。

重要なのは「推移分析」です。

分析してください。

分析内容:
1. CTR悪化傾向
2. CTR改善傾向
3. クリック減少傾向
4. キャンペーン別比較
5. 異常値
6. 改善提案
7. 今すぐやるべき施策
8. 経営者向けまとめ

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


app.get('/generate-ads-copy', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('ctr', { ascending: true })
      .limit(5)

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告のプロマーケターです。

以下はCTRが低い広告キャンペーンです。

改善のためのGoogle検索広告文を生成してください。

出力:
1. タイトル3案
2. 説明文3案
3. CTA
4. 改善理由
5. ターゲット

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
      ads_copy: completion.choices[0].message.content
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})


app.get('/save-trend-analysis', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告運用の専門家です。

以下はGoogle広告の日別データです。
推移を分析し、改善提案を作成してください。

分析内容:
1. CTR悪化傾向
2. CTR改善傾向
3. クリック減少傾向
4. キャンペーン別比較
5. 異常値
6. 改善提案
7. 今すぐやるべき施策
8. 経営者向けまとめ

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

    const reportContent = completion.choices[0].message.content

    const { data: savedReport, error: saveError } = await supabase
      .from('ai_reports')
      .insert([
        {
          report_type: 'trend_analysis',
          report_content: reportContent
        }
      ])
      .select()

    if (saveError) {
      throw saveError
    }

    res.json({
      message: 'AI trend analysis saved',
      report: savedReport
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})


app.get('/dashboard', async (req, res) => {
  try {
    const { data: reports } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(50)

    const { data: aiReports } = await supabase
      .from('ai_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    res.send(`
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>AI広告分析ダッシュボード</title>
          <style>
            body { font-family: sans-serif; padding: 24px; background: #f7f7f7; }
            h1 { margin-bottom: 8px; }
            .card { background: white; padding: 20px; border-radius: 12px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; background: white; }
            th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background: #eee; }
            pre { white-space: pre-wrap; line-height: 1.6; }
          </style>
        </head>
        <body>
          <h1>AI広告分析ダッシュボード</h1>
          <p>Google広告データとAI分析レポート</p>

          <div class="card">
            <h2>最新AI分析</h2>
            <pre>${aiReports?.[0]?.report_content || 'AIレポートはまだありません'}</pre>
          </div>

          <div class="card">
            <h2>広告データ</h2>
            <table>
              <tr>
                <th>日付</th>
                <th>キャンペーン</th>
                <th>表示回数</th>
                <th>クリック</th>
                <th>CTR</th>
              </tr>
              ${(reports || []).map(row => `
                <tr>
                  <td>${row.report_date}</td>
                  <td>${row.campaign_name}</td>
                  <td>${row.impressions}</td>
                  <td>${row.clicks}</td>
                  <td>${Number(row.ctr).toFixed(4)}</td>
                </tr>
              `).join('')}
            </table>
          </div>
        </body>
      </html>
    `)

  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/dashboard-v2', async (req, res) => {
  try {
    const { data: reports, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (error) throw error

    const labels = reports.map(r => r.report_date)
    const ctrData = reports.map(r => Number(r.ctr) * 100)

    res.send(`
<html>
<head>
  <meta charset="UTF-8">
  <title>AI広告分析ダッシュボード v2</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>AI広告分析ダッシュボード v2</h1>

  <div class="card">
    <h2>CTR推移</h2>
    <canvas id="ctrChart"></canvas>
  </div>

  <script>
    new Chart(document.getElementById('ctrChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'CTR (%)',
          data: ${JSON.stringify(ctrData)},
          borderWidth: 2,
          tension: 0.3
        }]
      }
    })
  </script>
</body>
</html>
    `)
  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/dashboard-v3', async (req, res) => {
  try {

    const { data: reports, error } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (error) throw error

    const grouped = {}

    reports.forEach(r => {

      if (!grouped[r.campaign_name]) {
        grouped[r.campaign_name] = []
      }

      grouped[r.campaign_name].push({
        x: r.report_date,
        y: Number(r.ctr) * 100
      })
    })

    const datasets = Object.keys(grouped).map((name, index) => ({
      label: name,
      data: grouped[name],
      borderWidth: 2,
      tension: 0.3
    }))

    res.send(`
<html>
<head>

<meta charset="UTF-8">

<title>AI広告分析ダッシュボード v3</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<style>

body{
  font-family:sans-serif;
  padding:24px;
  background:#f5f5f5;
}

.card{
  background:white;
  padding:24px;
  border-radius:12px;
  margin-bottom:24px;
}

</style>

</head>

<body>

<h1>AI広告分析ダッシュボード v3</h1>

<div class="card">
  <h2>キャンペーン別CTR推移</h2>
  <canvas id="chart"></canvas>
</div>

<script>

new Chart(document.getElementById('chart'), {

  type:'line',

  data:{
    datasets:${JSON.stringify(datasets)}
  },

  options:{
    parsing:false,

    scales:{
      x:{
        type:'category'
      },

      y:{
        beginAtZero:true,
        title:{
          display:true,
          text:'CTR (%)'
        }
      }
    }
  }

})

</script>

</body>
</html>
    `)

  } catch(error) {

    res.status(500).send(error.message)

  }
})


app.get('/dashboard-v4', async (req, res) => {
  try {
    const { start, end, campaign } = req.query

    let query = supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (start) {
      query = query.gte('report_date', start)
    }

    if (end) {
      query = query.lte('report_date', end)
    }

    if (campaign) {
      query = query.eq('campaign_name', campaign)
    }

    const { data: reports, error } = await query
    if (error) throw error

    const { data: campaignOptions, error: campaignError } = await supabase
      .from('campaign_reports')
      .select('campaign_name')

    if (campaignError) throw campaignError

    const uniqueCampaigns = [...new Set((campaignOptions || []).map(r => r.campaign_name))]

    const labels = reports.map(r => r.report_date)
    const ctrData = reports.map(r => Number(r.ctr) * 100)

    res.send(`
<html>
<head>
  <meta charset="UTF-8">
  <title>AI広告分析ダッシュボード v4</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
    form { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    label { display: block; font-weight: bold; margin-bottom: 4px; }
    input, select, button { padding: 8px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #eee; }
  </style>
</head>
<body>
  <h1>AI広告分析ダッシュボード v4</h1>

  <div class="card">
    <h2>検索条件</h2>

    <form method="GET" action="/dashboard-v4">
      <div>
        <label>開始日</label>
        <input type="date" name="start" value="${start || ''}">
      </div>

      <div>
        <label>終了日</label>
        <input type="date" name="end" value="${end || ''}">
      </div>

      <div>
        <label>キャンペーン</label>
        <select name="campaign">
          <option value="">すべて</option>
          ${uniqueCampaigns.map(name => `
            <option value="${name}" ${campaign === name ? 'selected' : ''}>${name}</option>
          `).join('')}
        </select>
      </div>

      <button type="submit">検索</button>
      <a href="/dashboard-v4">リセット</a>
    </form>
  </div>

  <div class="card">
    <h2>CTR推移</h2>
    <canvas id="ctrChart"></canvas>
  </div>

  <div class="card">
    <h2>広告データ</h2>
    <table>
      <tr>
        <th>日付</th>
        <th>キャンペーン</th>
        <th>表示回数</th>
        <th>クリック</th>
        <th>CTR</th>
      </tr>

      ${reports.map(r => `
        <tr>
          <td>${r.report_date}</td>
          <td>${r.campaign_name}</td>
          <td>${r.impressions}</td>
          <td>${r.clicks}</td>
          <td>${(Number(r.ctr) * 100).toFixed(2)}%</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <script>
    new Chart(document.getElementById('ctrChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'CTR (%)',
          data: ${JSON.stringify(ctrData)},
          borderWidth: 2,
          tension: 0.3
        }]
      }
    })
  </script>
</body>
</html>
    `)

  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/dashboard-v4', async (req, res) => {
  try {
    const { start, end, campaign } = req.query

    let query = supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (start) {
      query = query.gte('report_date', start)
    }

    if (end) {
      query = query.lte('report_date', end)
    }

    if (campaign) {
      query = query.eq('campaign_name', campaign)
    }

    const { data: reports, error } = await query
    if (error) throw error

    const { data: campaignOptions, error: campaignError } = await supabase
      .from('campaign_reports')
      .select('campaign_name')

    if (campaignError) throw campaignError

    const uniqueCampaigns = [...new Set((campaignOptions || []).map(r => r.campaign_name))]

    const labels = reports.map(r => r.report_date)
    const ctrData = reports.map(r => Number(r.ctr) * 100)

    res.send(`
<html>
<head>
  <meta charset="UTF-8">
  <title>AI広告分析ダッシュボード v4</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
    form { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    label { display: block; font-weight: bold; margin-bottom: 4px; }
    input, select, button { padding: 8px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #eee; }
  </style>
</head>
<body>
  <h1>AI広告分析ダッシュボード v4</h1>

  <div class="card">
    <h2>検索条件</h2>

    <form method="GET" action="/dashboard-v4">
      <div>
        <label>開始日</label>
        <input type="date" name="start" value="${start || ''}">
      </div>

      <div>
        <label>終了日</label>
        <input type="date" name="end" value="${end || ''}">
      </div>

      <div>
        <label>キャンペーン</label>
        <select name="campaign">
          <option value="">すべて</option>
          ${uniqueCampaigns.map(name => `
            <option value="${name}" ${campaign === name ? 'selected' : ''}>${name}</option>
          `).join('')}
        </select>
      </div>

      <button type="submit">検索</button>
      <a href="/dashboard-v4">リセット</a>
    </form>
  </div>

  <div class="card">
    <h2>CTR推移</h2>
    <canvas id="ctrChart"></canvas>
  </div>

  <div class="card">
    <h2>広告データ</h2>
    <table>
      <tr>
        <th>日付</th>
        <th>キャンペーン</th>
        <th>表示回数</th>
        <th>クリック</th>
        <th>CTR</th>
      </tr>

      ${reports.map(r => `
        <tr>
          <td>${r.report_date}</td>
          <td>${r.campaign_name}</td>
          <td>${r.impressions}</td>
          <td>${r.clicks}</td>
          <td>${(Number(r.ctr) * 100).toFixed(2)}%</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <script>
    new Chart(document.getElementById('ctrChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'CTR (%)',
          data: ${JSON.stringify(ctrData)},
          borderWidth: 2,
          tension: 0.3
        }]
      }
    })
  </script>
</body>
</html>
    `)

  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/sync-keywords', async (req, res) => {
  try {
    const accessToken = await getAccessToken()

    const query = `
      SELECT
        segments.date,
        campaign.name,
        ad_group_criterion.keyword.match_type,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr
      FROM keyword_view
      WHERE segments.date BETWEEN '2026-02-22' AND '2026-05-22'
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
        body: JSON.stringify({ query })
      }
    )

    const json = await response.json()

    if (!response.ok) {
      throw new Error(JSON.stringify(json))
    }

    const rows = (json.results || []).map((item) => ({
      report_date: item.segments.date,
      campaign_name: item.campaign.name,
      keyword_text: item.adGroupCriterion.keyword.text,
      match_type: item.adGroupCriterion.keyword.matchType,
      impressions: Number(item.metrics.impressions || 0),
      clicks: Number(item.metrics.clicks || 0),
      ctr: Number(item.metrics.ctr || 0),
      cost: 0,
      conversions: 0
    }))

    const { data, error } = await supabase
      .from('keyword_reports')
      .insert(rows)
      .select()

    if (error) {
      throw error
    }

    res.json({
      message: 'Keyword data synced',
      inserted: data.length
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})


app.get('/keywords-dashboard', async (req, res) => {
  try {

    const { start, end, campaign, keyword } = req.query

    let query = supabase
      .from('keyword_reports')
      .select('*')
      .order('report_date', { ascending: true })

    if (start) {
      query = query.gte('report_date', start)
    }

    if (end) {
      query = query.lte('report_date', end)
    }

    if (campaign) {
      query = query.eq('campaign_name', campaign)
    }

    if (keyword) {
      query = query.eq('keyword_text', keyword)
    }

    const { data: reports, error } = await query

    if (error) throw error

    const { data: keywordOptions } = await supabase
      .from('keyword_reports')
      .select('keyword_text')

    const { data: campaignOptions } = await supabase
      .from('keyword_reports')
      .select('campaign_name')

    const uniqueKeywords = [...new Set(
      (keywordOptions || []).map(r => r.keyword_text)
    )]

    const uniqueCampaigns = [...new Set(
      (campaignOptions || []).map(r => r.campaign_name)
    )]

    const labels = reports.map(r => r.report_date)

    const ctrData = reports.map(r => Number(r.ctr) * 100)

    const clickData = reports.map(r => Number(r.clicks))

    res.send(`
<html>
<head>

<meta charset="UTF-8">

<title>キーワード分析ダッシュボード</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

<style>

body{
  font-family:sans-serif;
  padding:24px;
  background:#f5f5f5;
}

.card{
  background:white;
  padding:24px;
  border-radius:12px;
  margin-bottom:24px;
}

form{
  display:flex;
  gap:12px;
  flex-wrap:wrap;
  align-items:end;
}

label{
  display:block;
  margin-bottom:4px;
  font-weight:bold;
}

input,select,button{
  padding:8px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,td{
  border-bottom:1px solid #ddd;
  padding:8px;
  text-align:left;
}

th{
  background:#eee;
}

</style>

</head>

<body>

<h1>キーワード分析ダッシュボード</h1>

<div class="card">

<h2>検索条件</h2>

<form method="GET" action="/keywords-dashboard">

<div>
<label>開始日</label>
<input type="date" name="start" value="${start || ''}">
</div>

<div>
<label>終了日</label>
<input type="date" name="end" value="${end || ''}">
</div>

<div>
<label>キャンペーン</label>

<select name="campaign">

<option value="">すべて</option>

${uniqueCampaigns.map(name => `
<option value="${name}" ${campaign === name ? 'selected' : ''}>
${name}
</option>
`).join('')}

</select>
</div>

<div>
<label>キーワード</label>

<select name="keyword">

<option value="">すべて</option>

${uniqueKeywords.map(name => `
<option value="${name}" ${keyword === name ? 'selected' : ''}>
${name}
</option>
`).join('')}

</select>

</div>

<button type="submit">検索</button>

</form>

</div>

<div class="card">

<h2>CTR推移</h2>

<canvas id="ctrChart"></canvas>

</div>

<div class="card">

<h2>クリック推移</h2>

<canvas id="clickChart"></canvas>

</div>

<div class="card">

<h2>キーワードデータ</h2>

<table>

<tr>
<th>日付</th>
<th>キャンペーン</th>
<th>キーワード</th>
<th>Match Type</th>
<th>表示回数</th>
<th>クリック</th>
<th>CTR</th>
</tr>

${reports.map(r => `
<tr>
<td>${r.report_date}</td>
<td>${r.campaign_name}</td>
<td>${r.keyword_text}</td>
<td>${r.match_type}</td>
<td>${r.impressions}</td>
<td>${r.clicks}</td>
<td>${(Number(r.ctr) * 100).toFixed(2)}%</td>
</tr>
`).join('')}

</table>

</div>

<script>

new Chart(document.getElementById('ctrChart'), {

type:'line',

data:{
labels:${JSON.stringify(labels)},
datasets:[{
label:'CTR (%)',
data:${JSON.stringify(ctrData)},
borderWidth:2,
tension:0.3
}]
}

})

new Chart(document.getElementById('clickChart'), {

type:'bar',

data:{
labels:${JSON.stringify(labels)},
datasets:[{
label:'Clicks',
data:${JSON.stringify(clickData)},
borderWidth:1
}]
}

})

</script>

</body>
</html>
    `)

  } catch(error) {

    res.status(500).send(error.message)

  }
})


app.get('/analyze-keywords', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('keyword_reports')
      .select('*')
      .order('ctr', { ascending: true })
      .limit(100)

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告のキーワード運用専門家です。

以下はGoogle広告のキーワード別データです。

分析してください。

分析内容:
1. 停止候補キーワード
2. 改善すべきキーワード
3. 伸ばすべきキーワード
4. 表示回数は多いがクリック率が低いキーワード
5. クリックはあるが成果が弱そうなキーワード
6. 広告文改善の方向性
7. 除外キーワード候補
8. 経営者向けまとめ

注意:
- CTRだけで判断しない
- 表示回数とクリック数も見る
- FileMaker開発・保守の問い合わせ獲得を目的に分析する
- 無料、求人、勉強、使い方だけの検索意図は質が低い可能性がある

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

    const reportContent = completion.choices[0].message.content

    const { data: savedReport, error: saveError } = await supabase
      .from('ai_reports')
      .insert([
        {
          report_type: 'keyword_analysis',
          report_content: reportContent
        }
      ])
      .select()

    if (saveError) {
      throw saveError
    }

    res.json({
      message: 'Keyword analysis completed and saved',
      analysis: reportContent,
      saved: savedReport
    })

  } catch (error) {
    res.status(500).json({
      error: error.message
    })
  }
})


app.get('/sync-search-terms', async (req, res) => {
  try {

    const accessToken = await getAccessToken()

    const query = `
      SELECT
        segments.date,
        campaign.name,
        search_term_view.search_term,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr
      FROM search_term_view
      WHERE segments.date BETWEEN '2026-02-22' AND '2026-05-22'
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

        body: JSON.stringify({ query })
      }
    )

    const json = await response.json()

    if (!response.ok) {
      throw new Error(JSON.stringify(json))
    }

    const rows = (json.results || []).map(item => ({

      report_date: item.segments.date,

      campaign_name: item.campaign.name,

      keyword_text:
        item.adGroupCriterion?.keyword?.text || '',

      search_term:
        item.searchTermView?.searchTerm || '',

      impressions:
        Number(item.metrics.impressions || 0),

      clicks:
        Number(item.metrics.clicks || 0),

      ctr:
        Number(item.metrics.ctr || 0),

      cost: 0,
      conversions: 0

    }))

    const { data, error } = await supabase
      .from('search_term_reports')
      .insert(rows)
      .select()

    if (error) {
      throw error
    }

    res.json({
      message: 'Search terms synced',
      inserted: data.length
    })

  } catch(error) {

    res.status(500).json({
      error: error.message
    })

  }
})


app.get('/analyze-search-terms', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('search_term_reports')
      .select('*')
      .order('ctr', { ascending: true })
      .limit(200)

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告の検索語句分析専門家です。

以下はGoogle広告の実検索語句データです。

分析してください。

分析内容:
1. 除外キーワード候補
2. 無駄クリック候補
3. 伸ばすべき検索語句
4. 問い合わせにつながりそうな検索語句
5. CTRが低い検索語句
6. 改善すべき広告グループ傾向
7. 今後追加すべきキーワード
8. 経営者向けまとめ

重要:
- FileMaker開発・保守案件獲得が目的
- 「無料」「勉強」「求人」「使い方」系は低品質候補
- BtoB向け視点で分析
- 検索意図を重視

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

    const reportContent = completion.choices[0].message.content

    const { data: savedReport, error: saveError } = await supabase
      .from('ai_reports')
      .insert([
        {
          report_type: 'search_term_analysis',
          report_content: reportContent
        }
      ])
      .select()

    if (saveError) {
      throw saveError
    }

    res.json({
      message: 'Search term analysis completed',
      analysis: reportContent,
      saved: savedReport
    })

  } catch(error) {

    res.status(500).json({
      error: error.message
    })

  }
})


app.get('/negative-keyword-suggestions', async (req, res) => {
  try {

    const { data, error } = await supabase
      .from('search_term_reports')
      .select('*')
      .order('impressions', { ascending: false })
      .limit(80)

    if (error) {
      throw error
    }

    const prompt = `
あなたはGoogle広告の除外キーワード最適化専門家です。

以下はGoogle広告の検索語句データです。

目的:
FileMaker開発・保守案件獲得

分析してください。

出力内容:
1. 除外推奨キーワード
2. 除外理由
3. 無駄クリック候補
4. 低品質検索意図
5. 今後追加すべき除外キーワード
6. 残すべき検索語句
7. 広告費浪費リスク
8. 経営者向けまとめ

重要:
- 「無料」
- 「求人」
- 「勉強」
- 「使い方」
- 「チュートリアル」
- 「初心者」

などは低品質候補。

BtoB問い合わせ獲得視点で分析してください。

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

    const reportContent = completion.choices[0].message.content

    const { data: savedReport, error: saveError } = await supabase
      .from('ai_reports')
      .insert([
        {
          report_type: 'negative_keyword_analysis',
          report_content: reportContent
        }
      ])
      .select()

    if (saveError) {
      throw saveError
    }

    res.json({
      message: 'Negative keyword analysis completed',
      analysis: reportContent,
      saved: savedReport
    })

  } catch(error) {

    res.status(500).json({
      error: error.message
    })

  }
})


app.get('/search-terms-dashboard', async (req, res) => {
  try {
    const { start, end, term } = req.query

    let query = supabase
      .from('search_term_reports')
      .select('*')
      .order('report_date', { ascending: false })

    if (start) {
      query = query.gte('report_date', start)
    }

    if (end) {
      query = query.lte('report_date', end)
    }

    if (term) {
      query = query.ilike('search_term', `%${term}%`)
    }

    const { data: reports, error } = await query.limit(300)
    if (error) throw error

    const { data: aiReports, error: aiError } = await supabase
      .from('ai_reports')
      .select('*')
      .eq('report_type', 'negative_keyword_analysis')
      .order('created_at', { ascending: false })
      .limit(1)

    if (aiError) throw aiError

    res.send(`
<html>
<head>
  <meta charset="UTF-8">
  <title>検索語句分析ダッシュボード</title>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
    form { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    label { display: block; font-weight: bold; margin-bottom: 4px; }
    input, button { padding: 8px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #eee; }
    pre { white-space: pre-wrap; line-height: 1.6; }
    .low { color: #c00; font-weight: bold; }
  </style>
</head>
<body>
  <h1>検索語句分析ダッシュボード</h1>

  <div class="card">
    <h2>検索条件</h2>
    <form method="GET" action="/search-terms-dashboard">
      <div>
        <label>開始日</label>
        <input type="date" name="start" value="${start || ''}">
      </div>

      <div>
        <label>終了日</label>
        <input type="date" name="end" value="${end || ''}">
      </div>

      <div>
        <label>検索語句</label>
        <input type="text" name="term" value="${term || ''}" placeholder="例: 無料 / 求人 / filemaker">
      </div>

      <button type="submit">検索</button>
      <a href="/search-terms-dashboard">リセット</a>
    </form>
  </div>

  <div class="card">
    <h2>最新AI除外キーワード分析</h2>
    <pre>${aiReports?.[0]?.report_content || 'まだ分析レポートがありません'}</pre>
  </div>

  <div class="card">
    <h2>検索語句データ</h2>

    <table>
      <tr>
        <th>日付</th>
        <th>キャンペーン</th>
        <th>検索語句</th>
        <th>表示回数</th>
        <th>クリック</th>
        <th>CTR</th>
      </tr>

      ${(reports || []).map(r => `
        <tr>
          <td>${r.report_date}</td>
          <td>${r.campaign_name}</td>
          <td>${r.search_term}</td>
          <td>${r.impressions}</td>
          <td>${r.clicks}</td>
          <td class="${Number(r.ctr) < 0.01 ? 'low' : ''}">
            ${(Number(r.ctr) * 100).toFixed(2)}%
          </td>
        </tr>
      `).join('')}
    </table>
  </div>
</body>
</html>
    `)

  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/search-terms-dashboard-v2', async (req, res) => {
  try {
    const { start, end, term } = req.query

    let query = supabase
      .from('search_term_reports')
      .select('*')
      .order('report_date', { ascending: false })

    if (start) query = query.gte('report_date', start)
    if (end) query = query.lte('report_date', end)
    if (term) query = query.ilike('search_term', `%${term}%`)

    const { data: reports, error } = await query.limit(300)
    if (error) throw error

    const grouped = (reports || []).reduce((acc, row) => {
      if (!acc[row.report_date]) acc[row.report_date] = []
      acc[row.report_date].push(row)
      return acc
    }, {})

    res.send(`
<html>
<head>
  <meta charset="UTF-8">
  <title>検索語句分析ダッシュボード v2</title>
  <style>
    body { font-family: sans-serif; padding: 24px; background: #f5f5f5; }
    .card { background: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
    form { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    input, button { padding: 8px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #eee; }
    h3 { margin-top: 28px; padding: 8px; background: #222; color: white; border-radius: 6px; }
    .low { color: #c00; font-weight: bold; }
  </style>
</head>
<body>
  <h1>検索語句分析ダッシュボード v2</h1>

  <div class="card">
    <form method="GET" action="/search-terms-dashboard-v2">
      <div>
        <label>開始日</label><br>
        <input type="date" name="start" value="${start || ''}">
      </div>
      <div>
        <label>終了日</label><br>
        <input type="date" name="end" value="${end || ''}">
      </div>
      <div>
        <label>検索語句</label><br>
        <input type="text" name="term" value="${term || ''}" placeholder="例: 無料 / 求人 / filemaker">
      </div>
      <button type="submit">検索</button>
      <a href="/search-terms-dashboard-v2">リセット</a>
    </form>
  </div>

  <div class="card">
    <h2>検索語句データ（日付別）</h2>

    ${Object.entries(grouped).map(([date, rows]) => `
      <h3>${date}</h3>
      <table>
        <tr>
          <th>キャンペーン</th>
          <th>検索語句</th>
          <th>表示回数</th>
          <th>クリック</th>
          <th>CTR</th>
        </tr>
        ${rows.map(r => `
          <tr>
            <td>${r.campaign_name}</td>
            <td>${r.search_term}</td>
            <td>${r.impressions}</td>
            <td>${r.clicks}</td>
            <td class="${Number(r.ctr) < 0.01 ? 'low' : ''}">
              ${(Number(r.ctr) * 100).toFixed(2)}%
            </td>
          </tr>
        `).join('')}
      </table>
    `).join('')}
  </div>
</body>
</html>
    `)

  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/ai-chat', (req, res) => {

  res.send(`
<html>
<head>

<meta charset="UTF-8">

<title>AI広告アシスタント</title>

<style>

body{
  font-family:sans-serif;
  background:#f5f5f5;
  padding:24px;
}

.card{
  background:white;
  padding:24px;
  border-radius:12px;
  max-width:900px;
  margin:auto;
}

textarea{
  width:100%;
  height:120px;
  padding:12px;
  font-size:16px;
}

button{
  margin-top:12px;
  padding:12px 20px;
  font-size:16px;
}

#response{
  margin-top:24px;
  white-space:pre-wrap;
  line-height:1.7;
}

</style>

</head>

<body>

<div class="card">

<h1>AI広告アシスタント</h1>

<p>
広告データについてAIへ質問できます。
</p>

<textarea id="question"
placeholder="例: CTRが悪い原因を教えて"></textarea>

<br>

<button onclick="sendQuestion()">
質問する
</button>

<div id="response"></div>

</div>

<script>

async function sendQuestion() {

  const question =
    document.getElementById('question').value

  document.getElementById('response').innerHTML =
    'AIが分析中です...'

  const response = await fetch('/chat-ai', {

    method:'POST',

    headers:{
      'Content-Type':'application/json'
    },

    body:JSON.stringify({
      question
    })

  })

  const data = await response.json()

  document.getElementById('response').innerHTML =
    data.answer || data.error

}

</script>

</body>
</html>
  `)

})

app.post('/chat-ai', async (req, res) => {

  try {

    const question = req.body.question

    const { data: reports } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending:false })
      .limit(50)

    const { data: keywords } = await supabase
      .from('keyword_reports')
      .select('*')
      .limit(50)

    const prompt = `
あなたはGoogle広告分析AIです。

以下は広告データです。

campaign_reports:
${JSON.stringify(reports, null, 2)}

keyword_reports:
${JSON.stringify(keywords, null, 2)}

ユーザー質問:
${question}

広告運用の専門家として回答してください。
`

    const completion =
      await openai.chat.completions.create({

      model:'gpt-4.1-mini',

      messages:[
        {
          role:'user',
          content:prompt
        }
      ]

    })

    const aiAnswer = completion.choices[0].message.content

    await supabase
      .from('ai_chat_history')
      .insert([
        {
          question,
          answer: aiAnswer
        }
      ])

    res.json({
      answer: aiAnswer
    })

  } catch(error) {

    res.status(500).json({
      error:error.message
    })

  }

})


app.get('/ai-chat-history', async (req, res) => {

  try {

    const { data, error } = await supabase
      .from('ai_chat_history')
      .select('*')
      .order('created_at', { ascending:false })
      .limit(50)

    if (error) throw error

    res.send(`

<html>
<head>

<meta charset="UTF-8">

<title>AIチャット履歴</title>

<style>

body{
  font-family:sans-serif;
  background:#f5f5f5;
  padding:24px;
}

.card{
  background:white;
  padding:24px;
  border-radius:12px;
  margin-bottom:24px;
}

.question{
  font-weight:bold;
  margin-bottom:12px;
}

.answer{
  white-space:pre-wrap;
  line-height:1.7;
}

.time{
  color:#666;
  font-size:12px;
  margin-bottom:16px;
}

</style>

</head>

<body>

<h1>AIチャット履歴</h1>

${data.map(row => `

<div class="card">

<div class="time">
${row.created_at}
</div>

<div class="question">
Q. ${row.question}
</div>

<div class="answer">
${row.answer}
</div>

</div>

`).join('')}

</body>
</html>

    `)

  } catch(error) {

    res.status(500).send(error.message)

  }

})


app.get('/ai-chat-v2', async (req, res) => {
  try {
    const { data: histories } = await supabase
      .from('ai_chat_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>AI広告チャット</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:24px;max-width:1000px;margin:auto;}
.container{max-width:900px;margin:auto;}
.card{padding:0;margin-bottom:20px;background:none;}
.user-card{background:#2563eb;color:white;padding:16px;border-radius:16px 16px 4px 16px;max-width:70%;margin-left:auto;margin-bottom:8px;}
.ai-card{background:white;padding:16px;border-radius:16px 16px 16px 4px;max-width:70%;box-shadow:0 2px 8px rgba(0,0,0,0.08);}

textarea{width:100%;height:100px;padding:12px;font-size:16px;}
button{padding:12px 20px;margin-top:10px;font-size:16px;}
.q{font-weight:bold;margin-bottom:8px;}
.a{white-space:pre-wrap;line-height:1.7;}
.time{color:#777;font-size:12px;margin-bottom:8px;}
</style>
</head>
<body>
<div class="container">
<h1>AI広告チャット</h1>

<div class="card">
<textarea id="question" placeholder="例：昨日の広告結果を教えて"></textarea>
<br>
<button onclick="sendQuestion()">送信</button>
</div>

<div id="chatHistory">
${(histories || []).map(row => `
  <div class="card">
    <div class="time">${row.created_at}</div>
    <div class="q">Q. ${row.question}</div>
    <div class="a">${row.answer}</div>
  </div>
`).join('')}
</div>
</div>

<script>
async function sendQuestion(){
  const question = document.getElementById('question').value
  if(!question) return

  const box = document.getElementById('chatHistory')
  box.insertAdjacentHTML('afterbegin', '<div class="card">AIが分析中です...</div>')

  const response = await fetch('/chat-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question})
  })

  const data = await response.json()

  location.reload()
}
</script>
</body>
</html>
    `)
  } catch(error) {
    res.status(500).send(error.message)
  }
})


app.get('/ai-chat-v3', async (req, res) => {
  try {
    const { data: histories } = await supabase
      .from('ai_chat_history')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(30)

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>AI広告チャット v3</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f7f8;margin:0;}
.wrapper{max-width:900px;margin:0 auto;padding:24px 20px 160px;}
h1{font-size:28px;margin-bottom:24px;}
.chat-row{display:flex;margin-bottom:22px;}
.chat-row.user{justify-content:flex-end;}
.bubble{padding:10px 14px;border-radius:18px;line-height:1.7;white-space:pre-wrap;max-width:45%;box-shadow:0 2px 8px rgba(0,0,0,.06);display:inline-block;}
.user .bubble{background:#2563eb;color:white;border-bottom-right-radius:4px;width:auto;max-width:45%;display:inline-block;padding:12px 16px;line-height:1.4;font-size:16px;}
.ai .bubble{background:white;color:#111;border-bottom-left-radius:4px;}
.name{font-size:12px;font-weight:bold;margin-bottom:4px;opacity:.75;}
.form-area{position:fixed;left:0;right:0;bottom:0;background:#f7f7f8;border-top:1px solid #ddd;padding:16px;}
.form-box{max-width:900px;margin:0 auto;display:flex;gap:10px;}
textarea{flex:1;height:70px;padding:14px;border-radius:14px;border:1px solid #ccc;font-size:15px;}
button{width:90px;border:0;border-radius:14px;background:#111;color:white;font-size:15px;}
</style>
</head>
<body>
<div class="wrapper">
<h1>AI広告チャット</h1>

${(histories || []).map(row => `
  <div class="chat-row user">
    <div class="bubble">
      <div class="name">あなた</div>
      ${row.question}
    </div>
  </div>

  <div class="chat-row ai">
    <div class="bubble">
      <div class="name">AI広告アシスタント</div>
      ${row.answer}
    </div>
  </div>
`).join('')}

</div>

<div class="form-area">
  <div class="form-box">
    <textarea id="question" placeholder="広告データについて質問してください"></textarea>
    <button onclick="sendQuestion()">送信</button>
  </div>
</div>

<script>
async function sendQuestion(){
  const question = document.getElementById('question').value
  if(!question.trim()) return

  await fetch('/chat-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({question})
  })

  location.reload()
}
window.scrollTo(0, document.body.scrollHeight)
</script>
</body>
</html>
    `)
  } catch(error) {
    res.status(500).send(error.message)
  }
})


/* chat compact css patch */
