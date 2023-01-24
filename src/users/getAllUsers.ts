import fetch from 'node-fetch'
import 'dotenv/config'

const CSOD_API_HOST = process.env.CSOD_API_HOST

export const getAllUsers = async (token: string) => {
  let apiUrl = `${CSOD_API_HOST}/x/odata/api/views/vw_rpt_user`;
  let allUsers: any[] = [];
  while(1) {
    const usersResp = await fetch(
      apiUrl, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": token
      },
      method: "GET",
    });
    const userPayload: any = await usersResp.json();
    const users: any[] = userPayload.value;
    allUsers = [...allUsers, ...users];
    if (users.length < 1000) {
      break;
    } else {
      apiUrl = userPayload['@odata.nextLink'];
    }
  }
  return allUsers;
}