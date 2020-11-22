const fs = require('fs').promises;

const gql = require('graphql-tag');
const axios = require('axios').default;
const cloudscraper = require('cloudscraper');
const { JSDOM } = require('jsdom');
const uuidv4 = require('uuid').v4;
const rimraf = require('rimraf');

const util = require('./util');

// noinspection JSUnusedGlobalSymbols
const plugin = {
  typeDefs: gql`type Mutation {
      addMyReadingManga(id: ID! number: String! url: String!): Result!
  }`,
  middleware: {
    Mutation: ({ BookModel, BookInfoModel, sequelize }, { pubsub, util: { saveImage } }, keys) => ({
      addMyReadingManga: async (parent, { id, number, url }) => {
        /* BookInfo check */
        const bookInfo = await BookInfoModel.findOne({
          where: { id },
        });
        if (!bookInfo) {
          return {
            success: false,
            message: 'info not found',
          };
        }

        /* get gallery info */
        await pubsub.publish(keys.ADD_BOOKS, {
          id,
          addBooks: 'Download Image Info',
        });
        const dom = await cloudscraper.get(url).then((data) => new JSDOM(data));
        const pagination = [dom];
        const paginationDom = dom.window.document.querySelectorAll('.entry-pagination.pagination > a');
        if (paginationDom) {
          const pageUrls = [...paginationDom]
            .filter((elem) => /\d+/.test(elem.textContent))
            .map((elem) => elem.href);
          for (let i = 0; i < pageUrls.length; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            await cloudscraper.get(pageUrls[i])
              .then((data) => {
                pagination.push(new JSDOM(data));
              });
          }
        }
        const imageUrls = pagination
          .map((d) => [...d.window.document.querySelectorAll('.entry-content noscript')]
            .map((i) => i.textContent.match(/(https?:\/\/[^"]+)"/)[1]))
          .flat();
        const pad = imageUrls.length.toString(10).length;

        /* write files */
        const bookId = uuidv4();
        const tempDir = `storage/book/${bookId}`;
        const catchFunc = (err) => new Promise((resolve, reject) => {
          rimraf(tempDir, () => {
            reject(err);
          });
        });
        await fs.mkdir(tempDir);
        const totalStr = imageUrls.length.toString().padStart(pad, '0');
        await util.asyncForEach(imageUrls, async (imageUrl, i) => {
          const filePath = `${tempDir}/${i.toString().padStart(pad, '0')}.jpg`;
          await pubsub.publish(keys.ADD_BOOKS, {
            id,
            addBooks: `Download Image ${i.toString().padStart(pad, '0')}/${totalStr}`,
          });
          const imageBuf = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
          }).then(({ data }) => Buffer.from(data, 'binary'));
          /*
          await pubsub.publish(keys.ADD_BOOKS, {
            id,
            addBooks: `Write Image ${i.toString().padStart(pad, '0')}`,
          });
          */
          await saveImage(filePath, imageBuf);
        }).catch(catchFunc);

        /* write database */
        await pubsub.publish(keys.ADD_BOOKS, {
          id,
          addBooks: 'Write Database',
        });
        const bThumbnail = `/book/${bookId}/${'0'.padStart(pad, '0')}.jpg`;
        await sequelize.transaction(async (transaction) => {
          await BookModel.create({
            id: bookId,
            thumbnail: bThumbnail,
            number,
            pages: imageUrls.length,
            infoId: id,
          }, {
            transaction,
          });
          await BookInfoModel.update({
            // @ts-ignore
            count: sequelize.literal('count + 1'),
          }, {
            where: {
              id,
            },
            transaction,
          });
          await BookInfoModel.update({
            history: false,
            count: 1,
          }, {
            where: {
              id,
              history: true,
            },
            transaction,
          });
          await BookInfoModel.update({
            thumbnail: bThumbnail,
          }, {
            where: {
              id,
              thumbnail: null,
            },
            transaction,
          });
        }).catch(catchFunc);

        return { success: true };
      },
    }),
  },
};

module.exports = plugin;
