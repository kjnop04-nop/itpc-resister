module.exports = {
  apps: [
    {
      name: "itpc-register",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
