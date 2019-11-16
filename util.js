module.exports = {
  asyncForEach: async (arr, callback) => {
    for (let i = 0; i < arr.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await callback(arr[i], i, arr);
    }
  },
};
