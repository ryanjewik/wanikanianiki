module.exports = function (api) {
  api.cache(true);
  // babel-preset-expo wires up the Reanimated/worklets plugin automatically,
  // so nothing else belongs here.
  return { presets: ['babel-preset-expo'] };
};
