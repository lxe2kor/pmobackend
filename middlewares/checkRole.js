
const checkRole = (role) => {
    return (req, res, next) => {
      if (req.user.logintype !== role) {
        return res.sendStatus(403);
      }
      next();
    };
};

module.exports = checkRole;