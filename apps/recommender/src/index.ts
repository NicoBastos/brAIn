import startRecommender from './server';

if (require.main === module) {
  // Run the server when invoked directly: `node ./dist/index.js` or `ts-node src/index.ts`
  startRecommender()
    .then(() => {
      /* started */
    })
    .catch((err) => {
      console.error('@brain/recommender: failed to start', err);
      process.exit(1);
    });
}

export default startRecommender;