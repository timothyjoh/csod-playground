import fetch from 'node-fetch'
import 'dotenv/config'

const CSOD_API_HOST = process.env.CSOD_API_HOST

export const getUserInfoById = async (token: string, userId: number) => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?$filter=user_id eq ${userId}`;
  const userResp = await fetch(apiUrl, {
      headers: {
      "Content-Type": "application/json",
      "Authorization": token
      },
      method: "GET"
  });
  const user: any = await userResp.json();
  return ({
      user: user.value[0]
  });
}