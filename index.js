import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const app = express()

app.use(express.json())

app.use(express.urlencoded({ extended: true }))

function getCookie(req, name) {
  const cookies = req.headers.cookie || ''
  const match = cookies.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? match[2] : null
}

function isProtectedPath(path) {
  return (
    path.startsWith('/main-dashboard') ||
    path.startsWith('/dashboard') ||
    path.startsWith('/keywords-dashboard') ||
    path.startsWith('/search-terms-dashboard') ||
    path.startsWith('/ai-chat') ||
    path.startsWith('/chat-ai')
  )
}

app.use((req, res, next) => {
  if (!isProtectedPath(req.path)) return next()

  const token = getCookie(req, 'ads_ai_login')
  if (token === process.env.APP_PASSWORD) return next()

  return res.redirect('/login')
})

app.get('/login', (req, res) => {
  res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>ログイン</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;height:100vh;}
.card{background:white;padding:32px;border-radius:16px;width:360px;box-shadow:0 8px 24px rgba(0,0,0,.08);}
input{width:100%;padding:12px;margin-top:12px;font-size:16px;}
button{width:100%;padding:12px;margin-top:16px;background:#111;color:white;border:0;border-radius:10px;font-size:16px;}
</style>
</head>
<body>
<div class="card">
<h1>ログイン</h1>
<form method="POST" action="/login">
<input type="password" name="password" placeholder="パスワード">
<button type="submit">ログイン</button>
</form>
</div>
</body>
</html>
  `)
})

app.post('/login', (req, res) => {
  if (req.body.password === process.env.APP_PASSWORD) {
    res.setHeader('Set-Cookie', `ads_ai_login=${process.env.APP_PASSWORD}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`)
    return res.redirect('/main-dashboard')
  }

  res.status(401).send('パスワードが違います')
})

app.get('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'ads_ai_login=; Path=/; Max-Age=0')
  res.redirect('/login')
})


const PORT = process.env.PORT || 3000

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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
  background:#f3f3f3;
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

app.get('/main-dashboard', async (req, res) => {
  try {
    const { data: campaigns } = await supabase
      .from('campaign_reports')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(50)

    const { data: searchTerms } = await supabase
      .from('search_term_reports')
      .select('*')
      .order('report_date', { ascending: false })
      .limit(50)

    const { data: aiReports } = await supabase
      .from('ai_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3)

    const totalClicks = (campaigns || []).reduce((sum, r) => sum + Number(r.clicks || 0), 0)
    const totalImpressions = (campaigns || []).reduce((sum, r) => sum + Number(r.impressions || 0), 0)
    const avgCtr = totalImpressions ? ((totalClicks / totalImpressions) * 100).toFixed(2) : 0

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>AI広告統合ダッシュボード</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:24px;}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}
.card{background:white;padding:20px;border-radius:12px;margin-bottom:20px;}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.kpi{background:#111;color:white;padding:20px;border-radius:12px;}
table{width:100%;border-collapse:collapse;}
th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;}
th{background:#f3f3f3;}
pre{white-space:pre-wrap;line-height:1.6;}
a{display:inline-block;margin-right:12px;}
</style>
</head>
<body>

<h1>AI広告統合ダッシュボード</h1>

<p>
<a href="/ai-chat-v3">AIチャット</a>
<a href="/dashboard-v4">キャンペーン分析</a>
<a href="/keywords-dashboard">キーワード分析</a>
<a href="/search-terms-dashboard-v2">検索語句分析</a>
</p>

<div class="kpis">
  <div class="kpi"><h3>総クリック</h3><h2>${totalClicks}</h2></div>
  <div class="kpi"><h3>総表示回数</h3><h2>${totalImpressions}</h2></div>
  <div class="kpi"><h3>平均CTR</h3><h2>${avgCtr}%</h2></div>
</div>

<div class="card">
  <h2>最新AIレポート</h2>
  <pre>${aiReports?.[0]?.report_content || 'AIレポートはまだありません'}</pre>
</div>

<div class="grid">
  <div class="card">
    <h2>キャンペーン最新データ</h2>
    <table>
      <tr><th>日付</th><th>キャンペーン</th><th>クリック</th><th>CTR</th></tr>
      ${(campaigns || []).map(r => `
        <tr>
          <td>${r.report_date}</td>
          <td>${r.campaign_name}</td>
          <td>${r.clicks}</td>
          <td>${(Number(r.ctr) * 100).toFixed(2)}%</td>
        </tr>
      `).join('')}
    </table>
  </div>

  <div class="card">
    <h2>検索語句最新データ</h2>
    <table>
      <tr><th>日付</th><th>検索語句</th><th>クリック</th><th>CTR</th></tr>
      ${(searchTerms || []).map(r => `
        <tr>
          <td>${r.report_date}</td>
          <td>${r.search_term}</td>
          <td>${r.clicks}</td>
          <td>${(Number(r.ctr) * 100).toFixed(2)}%</td>
        </tr>
      `).join('')}
    </table>
  </div>
</div>

</body>
</html>
    `)
  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/customers', async (req, res) => {
  try {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>顧客管理</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:24px;}
.card{background:white;padding:24px;border-radius:12px;margin-bottom:24px;}
input,textarea{width:100%;padding:10px;margin:6px 0 12px;font-size:14px;}
button{padding:12px 20px;background:#111;color:white;border:0;border-radius:10px;}
table{width:100%;border-collapse:collapse;background:white;}
th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left;}
th{background:#f3f3f3;}
</style>
</head>
<body>

<h1>顧客管理</h1>

<p>
<a href="/main-dashboard">メインダッシュボード</a>
</p>

<div class="card">
<h2>顧客追加</h2>

<form method="POST" action="/customers">
<label>顧客名</label>
<input name="customer_name" required>

<label>会社名</label>
<input name="company_name">

<label>担当者名</label>
<input name="contact_name">

<label>電話番号</label>
<input name="phone">

<label>メールアドレス</label>
<input name="email" type="email">

<label>メモ</label>
<textarea name="memo"></textarea>

<button type="submit">登録</button>
</form>
</div>

<div class="card">
<h2>顧客一覧</h2>

<table>
<tr>
<th>顧客名</th>
<th>会社名</th>
<th>担当者</th>
<th>電話</th>
<th>メール</th>
<th>メモ</th>
<th>登録日</th>
</tr>

${(customers || []).map(c => `
<tr>
<td>${c.customer_name || ''}</td>
<td>${c.company_name || ''}</td>
<td>${c.contact_name || ''}</td>
<td>${c.phone || ''}</td>
<td>${c.email || ''}</td>
<td>${c.memo || ''}</td>
<td>${c.created_at || ''}</td>
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

app.post('/customers', async (req, res) => {
  try {
    const {
      customer_name,
      company_name,
      contact_name,
      phone,
      email,
      memo
    } = req.body

    const { error } = await supabase
      .from('customers')
      .insert([
        {
          customer_name,
          company_name,
          contact_name,
          phone,
          email,
          memo
        }
      ])

    if (error) throw error

    res.redirect('/customers')
  } catch (error) {
    res.status(500).send(error.message)
  }
})


app.get('/profile', async (req, res) => {

  try {

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .limit(1)

    const user = users?.[0]

    res.send(`

<html>
<head>
<meta charset="UTF-8">
<title>マイページ</title>

<style>

body{
  font-family:sans-serif;
  background:#f5f5f5;
  padding:40px;
}

.container{
  max-width:800px;
  margin:auto;
}

.card{
  background:white;
  padding:32px;
  border-radius:20px;
  box-shadow:0 4px 20px rgba(0,0,0,.05);
}

h1{
  margin-bottom:24px;
}

label{
  display:block;
  margin-top:16px;
  margin-bottom:6px;
  font-weight:bold;
}

input{
  width:100%;
  padding:14px;
  border:1px solid #ddd;
  border-radius:10px;
  font-size:16px;
}

button{
  margin-top:24px;
  background:black;
  color:white;
  border:none;
  padding:14px 28px;
  border-radius:12px;
  font-size:16px;
  cursor:pointer;
}

.topbar{
  margin-bottom:24px;
}

a{
  color:black;
}

</style>

</head>

<body>

<div class="container">

<div class="topbar">
<a href="/main-dashboard">← ダッシュボードへ戻る</a>
</div>

<div class="card">

<h1>マイページ</h1>

<form method="POST" action="/profile">

<label>会社名</label>
<input
  name="company_name"
  value="${user?.company_name || ''}"
>

<label>担当者名</label>
<input
  name="contact_name"
  value="${user?.contact_name || ''}"
>

<label>電話番号</label>
<input
  name="phone"
  value="${user?.phone || ''}"
>

<label>メールアドレス</label>
<input
  name="email"
  value="${user?.email || ''}"
>

<button type="submit">
保存
</button>

</form>

</div>

</div>

</body>
</html>

    `)

  } catch(error) {

    res.status(500).send(error.message)

  }

})

app.post('/profile', async (req, res) => {

  try {

    const {
      company_name,
      contact_name,
      phone,
      email
    } = req.body

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .limit(1)

    const user = users?.[0]

    if(user){

      await supabase
        .from('users')
        .update({
          company_name,
          contact_name,
          phone,
          email
        })
        .eq('id', user.id)

    } else {

      await supabase
        .from('users')
        .insert([
          {
            company_name,
            contact_name,
            phone,
            email
          }
        ])

    }

    res.redirect('/profile')

  } catch(error) {

    res.status(500).send(error.message)

  }

})


app.get('/profile-settings', async (req, res) => {
  try {
    const { data: users } = await supabase
      .from('users')
      .select('*')
      .limit(1)

    const user = users?.[0] || {}

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>マイページ設定</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:40px;}
.container{max-width:900px;margin:auto;}
.card{background:white;padding:32px;border-radius:18px;margin-bottom:24px;}
label{display:block;margin-top:16px;font-weight:bold;}
input{width:100%;padding:12px;margin-top:6px;border:1px solid #ddd;border-radius:10px;}
button{margin-top:24px;padding:14px 28px;background:#111;color:white;border:0;border-radius:10px;}
small{color:#666;}
</style>
</head>
<body>
<div class="container">
<a href="/main-dashboard">← ダッシュボードへ戻る</a>
<h1>マイページ設定</h1>

<form method="POST" action="/profile-settings">

<div class="card">
<h2>基本情報</h2>

<label>会社名</label>
<input name="company_name" value="${user.company_name || ''}">

<label>担当者名</label>
<input name="contact_name" value="${user.contact_name || ''}">

<label>電話番号</label>
<input name="phone" value="${user.phone || ''}">

<label>メールアドレス</label>
<input name="email" value="${user.email || ''}">
</div>

<div class="card">
<h2>ログイン設定</h2>

<label>新しいパスワード</label>
<input name="password" type="password" placeholder="変更する場合のみ入力">
<small>空欄の場合は変更しません。</small>
</div>

<div class="card">
<h2>API設定</h2>

<label>OpenAI API Key</label>
<input name="openai_api_key" value="${user.openai_api_key || ''}">

<label>Google Ads Customer ID</label>
<input name="google_ads_customer_id" value="${user.google_ads_customer_id || ''}">

<label>Google Ads Login Customer ID</label>
<input name="google_ads_login_customer_id" value="${user.google_ads_login_customer_id || ''}">

<label>Google Ads Developer Token</label>
<input name="google_ads_developer_token" value="${user.google_ads_developer_token || ''}">

<label>Google Ads Refresh Token</label>
<input name="google_ads_refresh_token" value="${user.google_ads_refresh_token || ''}">
</div>

<button type="submit">保存</button>

</form>
</div>
</body>
</html>
    `)
  } catch(error) {
    res.status(500).send(error.message)
  }
})

app.post('/profile-settings', async (req, res) => {
  try {
    const {
      company_name,
      contact_name,
      phone,
      email,
      password,
      openai_api_key,
      google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token,
      google_ads_refresh_token
    } = req.body

    const updateData = {
      company_name,
      contact_name,
      phone,
      email,
      openai_api_key,
      google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token,
      google_ads_refresh_token
    }

    if (password && password.trim() !== '') {
      updateData.password = password
    }

    const { data: users } = await supabase
      .from('users')
      .select('*')
      .limit(1)

    const user = users?.[0]

    if (user) {
      await supabase
        .from('users')
        .update(updateData)
        .eq('id', user.id)
    } else {
      await supabase
        .from('users')
        .insert([updateData])
    }

    res.redirect('/profile-settings')
  } catch(error) {
    res.status(500).send(error.message)
  }
})


app.get('/profile-settings-v2', async (req, res) => {
  try {
    const errorMessage = req.query.error || ''
    const { data: users } = await supabase.from('users').select('*').limit(1)
    const user = users?.[0] || {}

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>マイページ設定 v2</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:40px;}
.container{max-width:900px;margin:auto;}
.card{background:white;padding:32px;border-radius:18px;margin-bottom:24px;}
label{display:block;margin-top:16px;font-weight:bold;}
input{width:100%;padding:12px;margin-top:6px;border:1px solid #ddd;border-radius:10px;}
button{margin-top:24px;padding:14px 28px;background:#111;color:white;border:0;border-radius:10px;}
.input-row{display:flex;gap:8px;align-items:center;}
.input-row input{flex:1;}
.eye{width:44px;padding:12px;margin-top:6px;background:#f3f3f3;color:#111;border-radius:10px;}
.error{background:#ffe5e5;color:#b00020;padding:12px;border-radius:10px;margin-bottom:16px;}
</style>
</head>
<body>
<div class="container">
<a href="/main-dashboard">← ダッシュボードへ戻る</a>
<h1>マイページ設定</h1>

${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}

<form method="POST" action="/profile-settings-v2">

<div class="card">
<h2>基本情報</h2>
<label>会社名</label><input name="company_name" value="${user.company_name || ''}">
<label>担当者名</label><input name="contact_name" value="${user.contact_name || ''}">
<label>電話番号</label><input name="phone" value="${user.phone || ''}">
<label>メールアドレス</label><input name="email" value="${user.email || ''}">
</div>

<div class="card">
<h2>ログイン設定</h2>
<label>新しいパスワード</label>
<div class="input-row">
<input id="password" name="password" type="password" placeholder="変更する場合のみ入力">
<button class="eye" type="button" onclick="toggle('password')">👁</button>
</div>

<label>新しいパスワード確認</label>
<div class="input-row">
<input id="password_confirm" name="password_confirm" type="password" placeholder="もう一度入力">
<button class="eye" type="button" onclick="toggle('password_confirm')">👁</button>
</div>
</div>

<div class="card">
<h2>API設定</h2>

<label>OpenAI API Key</label>
<div class="input-row">
<input id="openai_api_key" name="openai_api_key" type="password" value="${user.openai_api_key || ''}">
<button class="eye" type="button" onclick="toggle('openai_api_key')">👁</button>
</div>

<label>Google Ads Customer ID</label>
<input name="google_ads_customer_id" value="${user.google_ads_customer_id || ''}">

<label>Google Ads Login Customer ID</label>
<input name="google_ads_login_customer_id" value="${user.google_ads_login_customer_id || ''}">

<label>Google Ads Developer Token</label>
<div class="input-row">
<input id="google_ads_developer_token" name="google_ads_developer_token" type="password" value="${user.google_ads_developer_token || ''}">
<button class="eye" type="button" onclick="toggle('google_ads_developer_token')">👁</button>
</div>

<label>Google Ads Refresh Token</label>
<div class="input-row">
<input id="google_ads_refresh_token" name="google_ads_refresh_token" type="password" value="${user.google_ads_refresh_token || ''}">
<button class="eye" type="button" onclick="toggle('google_ads_refresh_token')">👁</button>
</div>
</div>

<button type="submit">保存</button>
</form>
</div>

<script>
function toggle(id){
  const el = document.getElementById(id)
  el.type = el.type === 'password' ? 'text' : 'password'
}
</script>
</body>
</html>
    `)
  } catch(error) {
    res.status(500).send(error.message)
  }
})

app.post('/profile-settings-v2', async (req, res) => {
  try {
    const {
      company_name, contact_name, phone, email,
      password, password_confirm,
      openai_api_key, google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token, google_ads_refresh_token
    } = req.body

    if (password || password_confirm) {
      if (password !== password_confirm) {
        return res.redirect('/profile-settings-v2?error=' + encodeURIComponent('パスワードと確認用パスワードが一致しません'))
      }
    }

    const updateData = {
      company_name,
      contact_name,
      phone,
      email,
      openai_api_key,
      google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token,
      google_ads_refresh_token
    }

    if (password && password.trim() !== '') {
      updateData.password = password
    }

    const { data: users } = await supabase.from('users').select('*').limit(1)
    const user = users?.[0]

    if (user) {
      await supabase.from('users').update(updateData).eq('id', user.id)
    } else {
      await supabase.from('users').insert([updateData])
    }

    res.redirect('/profile-settings-v2')
  } catch(error) {
    res.status(500).send(error.message)
  }
})


app.get('/profile-settings-v3', async (req, res) => {
  try {
    const errorMessage = req.query.error || ''
    const { data: users } = await supabase.from('users').select('*').limit(1)
    const user = users?.[0] || {}

    const eyeOpen = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="black" viewBox="0 0 24 24">
        <path d="M12 5C5 5 1 12 1 12s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
      </svg>
    `

    const eyeClosed = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="black" viewBox="0 0 24 24">
        <path d="M2 2l20 20-1.5 1.5-4.2-4.2A12.7 12.7 0 0 1 12 19C5 19 1 12 1 12a21.5 21.5 0 0 1 5-5.7L.5 2.5 2 1z"/>
        <path d="M12 5c7 0 11 7 11 7a20.7 20.7 0 0 1-3.8 4.6l-2.1-2.1A4 4 0 0 0 9.5 6.9L7.9 5.3A13 13 0 0 1 12 5z"/>
      </svg>
    `

    res.send(`
<html>
<head>
<meta charset="UTF-8">
<title>マイページ設定</title>
<style>
body{font-family:sans-serif;background:#f5f5f5;padding:40px;}
.container{max-width:900px;margin:auto;}
.card{background:white;padding:32px;border-radius:18px;margin-bottom:24px;}
label{display:block;margin-top:16px;font-weight:bold;}
input{width:100%;padding:12px;margin-top:6px;border:1px solid #ddd;border-radius:10px;font-size:15px;}
button{margin-top:24px;padding:14px 28px;background:#111;color:white;border:0;border-radius:10px;font-size:15px;}
.input-row{display:flex;gap:8px;align-items:center;}
.input-row input{flex:1;}
.eye{width:42px;height:42px;margin-top:6px;padding:8px;background:#f3f3f3;color:#111;border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;}
.error{background:#ffe5e5;color:#b00020;padding:12px;border-radius:10px;margin-bottom:16px;}
small{color:#666;}
</style>
</head>
<body>
<div class="container">
<a href="/main-dashboard">← ダッシュボードへ戻る</a>
<h1>マイページ設定</h1>

${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}

<form method="POST" action="/profile-settings-v3">

<div class="card">
<h2>基本情報</h2>

<label>会社名</label>
<input name="company_name" value="${user.company_name || ''}">

<label>担当者名</label>
<input name="contact_name" value="${user.contact_name || ''}">

<label>電話番号</label>
<input name="phone" value="${user.phone || ''}">

<label>メールアドレス</label>
<input name="email" value="${user.email || ''}">
</div>

<div class="card">
<h2>ログイン設定</h2>

<label>新しいパスワード</label>
<div class="input-row">
<input id="password" name="password" type="password" placeholder="変更する場合のみ入力">
<button class="eye" type="button" onclick="togglePassword('password', this)">${eyeClosed}</button>
</div>

<label>新しいパスワード確認</label>
<div class="input-row">
<input id="password_confirm" name="password_confirm" type="password" placeholder="もう一度入力">
<button class="eye" type="button" onclick="togglePassword('password_confirm', this)">${eyeClosed}</button>
</div>

<small>パスワードを変更する場合は、2つの入力欄に同じ値を入力してください。</small>
</div>

<div class="card">
<h2>API設定</h2>

<label>Google Ads Customer ID</label>
<input name="google_ads_customer_id" value="${user.google_ads_customer_id || ''}">

<label>Google Ads Login Customer ID</label>
<input name="google_ads_login_customer_id" value="${user.google_ads_login_customer_id || ''}">

<label>OpenAI API Key</label>
<div class="input-row">
<input id="openai_api_key" name="openai_api_key" type="password" value="${user.openai_api_key || ''}">
<button class="eye" type="button" onclick="togglePassword('openai_api_key', this)">${eyeClosed}</button>
</div>

<label>Google Ads Developer Token</label>
<div class="input-row">
<input id="google_ads_developer_token" name="google_ads_developer_token" type="password" value="${user.google_ads_developer_token || ''}">
<button class="eye" type="button" onclick="togglePassword('google_ads_developer_token', this)">${eyeClosed}</button>
</div>

<label>Google Ads Refresh Token</label>
<div class="input-row">
<input id="google_ads_refresh_token" name="google_ads_refresh_token" type="password" value="${user.google_ads_refresh_token || ''}">
<button class="eye" type="button" onclick="togglePassword('google_ads_refresh_token', this)">${eyeClosed}</button>
</div>

</div>

<button type="submit">保存</button>
</form>
</div>

<script>
const eyeOpen = \`${eyeOpen}\`
const eyeClosed = \`${eyeClosed}\`

function togglePassword(id, btn){
  const el = document.getElementById(id)
  if(el.type === 'password'){
    el.type = 'text'
    btn.innerHTML = eyeOpen
  } else {
    el.type = 'password'
    btn.innerHTML = eyeClosed
  }
}
</script>
</body>
</html>
    `)
  } catch(error) {
    res.status(500).send(error.message)
  }
})

app.post('/profile-settings-v3', async (req, res) => {
  try {
    const {
      company_name,
      contact_name,
      phone,
      email,
      password,
      password_confirm,
      openai_api_key,
      google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token,
      google_ads_refresh_token
    } = req.body

    if (password || password_confirm) {
      if (password !== password_confirm) {
        return res.redirect('/profile-settings-v3?error=' + encodeURIComponent('パスワードと確認用パスワードが一致しません'))
      }
    }

    const updateData = {
      company_name,
      contact_name,
      phone,
      email,
      openai_api_key,
      google_ads_customer_id,
      google_ads_login_customer_id,
      google_ads_developer_token,
      google_ads_refresh_token
    }

    if (password && password.trim() !== '') {
      updateData.password = password
    }

    const { data: users } = await supabase.from('users').select('*').limit(1)
    const user = users?.[0]

    if (user) {
      await supabase.from('users').update(updateData).eq('id', user.id)
    } else {
      await supabase.from('users').insert([updateData])
    }

    res.redirect('/profile-settings-v3')
  } catch(error) {
    res.status(500).send(error.message)
  }
})

