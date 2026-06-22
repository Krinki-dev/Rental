const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const env = require('./config/env');
const { loadUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const tenantRoutes = require('./routes/tenant');
const apiRoutes = require('./routes/api');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(loadUser);

// Make company/payment details available to every view without
// repeating them in each route.
app.use((req, res, next) => {
  res.locals.company = env.company;
  res.locals.appBaseUrl = env.appBaseUrl;
  next();
});

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/tenant', tenantRoutes);
app.use('/api', apiRoutes);

app.use((req, res) => {
  res.status(404).render('not-found');
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again, or contact support.');
});

const port = env.port;
app.listen(port, () => {
  console.log(`Rental management app running on http://localhost:${port}`);
});
