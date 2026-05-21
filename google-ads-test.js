import 'dotenv/config'
import { GoogleAdsApi } from 'google-ads-api'

const client = new GoogleAdsApi({
  client_id: process.env.GOOGLE_ADS_CLIENT_ID,
  client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN
})

const customer = client.Customer({
  customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
  login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN
})

async function main() {
  const campaigns = await customer.query(`
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type
    FROM campaign
    ORDER BY campaign.id
    LIMIT 20
  `)

  console.log(campaigns)
}

main().catch((error) => {
  console.error('ERROR:', error)
})