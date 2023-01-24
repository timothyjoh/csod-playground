import fetch from 'node-fetch'
import 'dotenv/config'

const CSOD_API_HOST = process.env.CSOD_API_HOST

export const getUsersByPagination = async (token: string, pageNo: number, top: number) => {
  if (pageNo < 0) {
    return null;
  }
  pageNo = pageNo === 0 ? pageNo : pageNo - 1;
  const usersResp = await fetch(
    `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user?$top=${top}&$pageNo=${pageNo}&$count=true`, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": token
    },
    method: "GET",
  });
  const userPayload: any = await usersResp.json();
  return {
    pageNo,
    users: userPayload['value'],
    total: userPayload['@odata.count']
  }
};