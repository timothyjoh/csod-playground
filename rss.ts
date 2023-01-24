import https from 'https'
import { Feed } from 'feed'

import aws from 'aws-sdk'
aws.config.update({ region: 'us-east-1' })

const s3 = new aws.S3()

const { BUCKET_NAME, FOLDER, CONTENT_STACK_UID, CONTENT_STACK_ACCESS_TOKEN } =
  process.env

const rssGraphQL = {
  query: `{
    all_page_resource(
        locale: "en-gb",
        skip: 0
        limit: 100
        order_by: [
            created_at_DESC, updated_at_DESC
        ],
        where: {tags_in: ["client-schneider"]}
        ) {
        total
        items {
            url
            resourceConnection {
                edges {
                    node {
                        ... on TopicResource {
                            title
                            authorConnection {
                                 edges {
                                     node {
                                        ... on TopicAuthor {
                                            name
                                        }
                                     }
                                 }
                            }
                            short_description
                            feature_imageConnection {
                                edges {
                                    node {
                                        url
                                        description
                                    }
                                }
                            }
                            publication_date
                            body
                        }
                    }
                }
            }
        }
      }
    }`,
}

const rssGraphQLString = JSON.stringify(rssGraphQL)

const graphQLRequestOptions = {
  hostname: 'graphql.contentstack.com',
  port: 443,
  path: `/stacks/blt55a486d156678036?environment=production`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': rssGraphQLString.length,
    access_token: 'cs51933b3c2ff41f2d7ff6c31a',
  },
}

const getArticles = () => {
  return new Promise((resolve, reject) => {
    var response = ''
    const request = https
      .request(graphQLRequestOptions, (res) => {
        res.on('data', (d) => {
          response += d
        })
        res.on('end', () => {
          resolve(JSON.parse(response))
        })
      })
      .on('error', (e) => {
        reject(e)
      })
    request.write(rssGraphQLString)
    request.end()
  })
}

const buildRSS = (articles) => {
  const feed = new Feed({
    title: 'Richardson Sales Performance Training Company',
    description: 'A Legacy of Expertise. The Future of Selling.',
    id: 'https://www.richardson.com/',
    link: 'https://www.richardson.com/',
    language: 'en',
    copyright: 'Richardson',
    image:
      'https://www.richardson.com/static/04a06942ffef28879f98d3d1cccdd0bf/d7485/logo-light-theme.webp',
    favicon:
      'https://www.richardson.com/favicon-32x32.png?v=a6438e19d776727d43a713d1ec5fa784',
  })

  articles.data.all_page_resource.items.forEach((article) => {
    const articleDetails = article.resourceConnection.edges[0].node
    const image = articleDetails.feature_imageConnection.edges[0]?.node?.url
    const author = articleDetails.authorConnection.edges[0]?.node?.name

    feed.addItem({
      title: articleDetails.title,
      id: article.url,
      link: `https://www.richardson.com${article.url}`,
      description: articleDetails.short_description,
      content: articleDetails.body,
      author: [
        {
          name: author,
          email: author,
        },
      ],
      date: new Date(articleDetails.publication_date),
      image,
    })
  })

  return feed.rss2()
}

const buildJSON = (articles) => {
  const jsonArticles = {
    loadMore: true,
    posts: [],
  }

  articles.data.all_page_resource.items.forEach((article) => {
    const articleDetails = article.resourceConnection.edges[0].node
    const image = articleDetails.feature_imageConnection.edges[0]?.node

    ;(jsonArticles.posts as any[]).push({
      title: articleDetails.title,
      date: articleDetails.publication_date,
      link_text: 'N/A',
      link: `https://www.richardson.com${article.url}`,
      teaser: `<p>${articleDetails.short_description}</p>`,
      thumb: `<img width="311" height="191" src="${image?.url}" class="attachment-blog-thumbnail" alt="${image?.description}" />`,
    })
  })

  return JSON.stringify(jsonArticles)
}

// function uploadToS3(objectName, objectData, contentType) {
//   const params = {
//     Bucket: BUCKET_NAME,
//     Key: FOLDER ? `${FOLDER}/${objectName}` : objectName,
//     Body: objectData,
//     ContentType: contentType,
//   }
//   return new Promise((resolve, reject) => {
//     s3.putObject(params, function (err, result) {
//       if (err) {
//         reject(err)
//       }
//       if (result) {
//         resolve(`File uploaded successfully at ${params.Bucket}/${params.Key}`)
//       }
//     })
//   })
// }

const handler = async () => {
  let error
  let status

  try {
    const articles = await getArticles()

    const rss = buildRSS(articles)
    // status = await uploadToS3('accelerate-articles.rss', rss, 'application/xml')
    // status += '\n'

    const json = buildJSON(articles)
    // status += await uploadToS3(
    //   'accelerate-articles.json',
    //   json,
    //   'application/json'
    // )

    console.log({ json })
    console.log(status)
  } catch (err) {
    error = err
    console.error(error)
  }

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    }
  } else {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: status,
      }),
    }
  }
}

handler()
