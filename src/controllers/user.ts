import * as async from "async";
import * as crypto from "crypto";
import * as nodemailer from "nodemailer";
import * as passport from "passport";
import { default as User, AuthToken } from "../models/User";
import { Request, Response, NextFunction } from "express";
import { IVerifyOptions } from "passport-local";
import { INode, Neo4jError } from "neo4js";
const request = require("express-validator");

/**
 * POST /login
 * Sign in using email and password.
 */
export let login = (req: Request, res: Response, next: NextFunction) => {
  req.assert("email", "Email is not valid").isEmail();
  req.assert("password", "Password cannot be blank").notEmpty();
  req.sanitize("email").normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  passport.authenticate("local", (err: Error, user: INode, info: IVerifyOptions) => {
    if (err) { return next(err); }
    if (!user) {
      return res.status(400).send(info.message);
    }
    req.logIn(user, (err: Error) => {
      if (err) { return next(err); }
      res.status(200).send("Success! You are logged in.");
    });
  })(req, res, next);
};

/**
 * GET /logout
 * Log out.
 */
export let logout = (req: Request, res: Response) => {
  req.logout();
  res.status(200).send("Logged out.");
};

/**
 * POST /signup
 * Create a new local account.
 */
export let signup = (req: Request, res: Response, next: NextFunction) => {
  req.assert("email", "Email is not valid").isEmail();
  req.assert("password", "Password must be at least 4 characters long").len({ min: 4 });
  req.assert("confirmPassword", "Passwords do not match").equals(req.body.password);
  req.sanitize("email").normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  const user = new User({
    email: req.body.email,
    password: req.body.password
  });

  User.findOne({ email: req.body.email }, (err, existingUser) => {
    if (err) { next(err); }
    if (existingUser) {
      return res.status(400).send("Account with that email address already exists.");
    }
    user.save((err: Error) => {
      if (err) { return next(err); }
      req.logIn(user, (err: Error) => {
        if (err) {
          return next(err);
        }
        res.status(201).send("Success! User registered.");
      });
    });
  });
};

/**
 * GET /account
 * Profile page.
 */
export let account = (req: Request, res: Response) => {
  delete req.user.password;
  delete req.user._id;
  res.status(200).send(req.user);
};

/**
 * POST /account/profile
 * Update profile information.
 */
export let postUpdateProfile = (req: Request, res: Response, next: NextFunction) => {
  if (req.body.email) {
    req.assert("email", "Please enter a valid email address.").isEmail();
    req.sanitize("email").normalizeEmail({ gmail_remove_dots: false });
  }

  req.assert("gender", "Please enter 'Male' or 'Female'").isIn(["Male", "Female"]);
  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  User.findOne({ email: req.user.email }, (err, user: INode) => {
    if (err) { return next(err); }
    user.email = req.body.email || user.email;
    user.name = req.body.name || "";
    user.gender = req.body.gender || "";
    user.location = req.body.location || "";
    user.website = req.body.website || "";
    user.save((err: Neo4jError) => {
      if (process.env.NODE_ENV == "development") {
        console.error(err);
      }
      if (err) {
        return res.status(400).send("The email address you have entered is already associated with an account.");
      }
      res.status(200).send({message: "Profile information has been updated.", });
    });
  });
};

/**
 * POST /account/password
 * Update current password.
 */
export let postUpdatePassword = (req: Request, res: Response, next: NextFunction) => {
  req.assert("password", "Password must be at least 4 characters long").len({ min: 4 });
  req.assert("confirmPassword", "Passwords do not match").equals(req.body.password);

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  User.findOne({ email: req.user.email }, (err: Error, user: INode) => {
    if (err) { return next(err); }
    user.password = req.body.password;
    user.save((err: Neo4jError) => {
      if (err) { return next(err); }
      res.status(200).send("Password has been changed.");
    });
  });
};

/**
 * POST /account/delete
 * Delete user account.
 */
export let postDeleteAccount = (req: Request, res: Response, next: NextFunction) => {
  User.remove({ email: req.user.email }, (err: Neo4jError) => {
    if (err) { return next(err); }
    req.logout();
    res.status(200).send("Your account has been deleted.");
  });
};

/**
 * GET /account/unlink/:provider
 * Unlink OAuth provider.
 */
export let getOauthUnlink = (req: Request, res: Response, next: NextFunction) => {
  const provider = req.params.provider;
  User.findOne({ email: req.user.email }, (err, user: any) => {
    if (err) { return next(err); }
    user[provider] = undefined;
    user.tokens = user.tokens.filter((token: AuthToken) => token.kind !== provider);
    user.save((err: Error) => {
      if (err) { return next(err); }
      res.status(200).send(`${provider} account has been unlinked`);
    });
  });
};

/**
 * GET /reset/:token
 * Verify reset token
 */
export let getReset = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) {
    return res.status(401).send("You are already logged in.");
  }
  User.findOne({ passwordResetToken: req.params.token }, (err, user) => {
        if (err) { return next(err); }
        if (!user  || user.passwordResetToken < Date.now()) {
          return res.status(403).send("Password reset token is invalid or has expired.");
        }

        res.status(200).send("Password reset token is valid.");
    });
};

/**
 * POST /reset/:token
 * Process the reset password request.
 */
export let postReset = (req: Request, res: Response, next: NextFunction) => {
  req.assert("password", "Password must be at least 4 characters long.").len({ min: 4 });
  req.assert("confirmPassword", "Passwords must match.").equals(req.body.password);

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  async.waterfall([
    function resetPassword(done: Function) {
      User
        .findOne({ passwordResetToken: req.params.token }, (err, user: any) => {
          if (err) { return done(next(err), user); }
          if (!user || user.passwordResetToken < Date.now()) {
            done(new Error("User not found"));
          }
          user.password = req.body.password;
          user.passwordResetToken = undefined;
          user.passwordResetExpires = undefined;
          user.save((err: Neo4jError) => {
            if (err) { return next(err); }
            req.logIn(user, (err: Error) => {
              done(err, user);
            });
          });
        });
    },
    function sendResetPasswordEmail(user: INode, done: Function) {
      const transporter = nodemailer.createTransport({
        service: "SendGrid",
        auth: {
          user: process.env.SENDGRID_USER,
          pass: process.env.SENDGRID_PASSWORD
        }
      });
      const mailOptions = {
        to: user.email.toString(),
        from: "service@cooper.com",
        subject: "Your password has been changed",
        text: `Hello,\n\nThis is a confirmation that the password for your account ${user.email} has just been changed.\n`
      };
      transporter.sendMail(mailOptions, (err: Error) => {
        res.status(200).send("Success! Your password has been changed.");
        done(err);
      });
    }
  ], (err: Error) => {
    if (err) { return next(err); }
    res.status(500).send("Something went terribly wrong");
  });
};

/**
 * POST /forgot
 * Create a random token, then the send user an email with a reset link.
 */
export let forgot = (req: Request, res: Response, next: NextFunction) => {
  req.assert("email", "Please enter a valid email address.").isEmail();
  req.sanitize("email").normalizeEmail({ gmail_remove_dots: false });

  const errors = req.validationErrors();

  if (errors) {
    return res.status(400).send(errors);
  }

  async.waterfall([
    function createRandomToken(done: Function) {
      crypto.randomBytes(16, (err, buf) => {
        const token = buf.toString("hex");
        done(err, token);
      });
    },
    function setRandomToken(token: AuthToken, done: Function) {
      User.findOne({ email: req.body.email }, (err, user: any) => {
        if (err) { return done(err); }
        if (!user) { done(new Error("User not found")); }
        user.passwordResetToken = token;
        user.passwordResetExpires = Date.now() + 3600000; // 1 hour
        user.save((err: Error) => {
          done(err, token, user);
        });
      });
    },
    function sendForgotPasswordEmail(token: AuthToken, user: INode, done: Function) {
      const transporter = nodemailer.createTransport({
        service: "SendGrid",
        auth: {
          user: process.env.SENDGRID_USER,
          pass: process.env.SENDGRID_PASSWORD
        }
      });
      const mailOptions = {
        to: user.email.toString(),
        from: "service@cooper.com",
        subject: "Reset your password on Cooper",
        text: `You are receiving this email because you (or someone else) have requested the reset of the password for your account.\n\n
          Please click on the following link, or paste this into your browser to complete the process:\n\n
          http://${req.headers.host}/reset/${token}\n\n
          If you did not request this, please ignore this email and your password will remain unchanged.\n`
      };
      transporter.sendMail(mailOptions, (err: Error) => {
        res.status(200).send(`An e-mail has been sent to ${user.email} with further instructions.`);
        done(err);
      });
    }
  ], (err: Error) => {
    if (err) {
      if (err.message === "User not found") {
        return res.status(200).send(`An e-mail has been sent to ${req.body.email} with further instructions.`);
      }
      return next(err);
    }
    res.status(500).send("Something went terribly wrong");
  });
};