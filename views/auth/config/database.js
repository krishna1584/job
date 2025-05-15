// config/database.js
const mongoose = require('mongoose');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const flash = require('connect-flash');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// MongoDB Atlas Connection
async function connectDB(app) {
    try {
        // Replace with your MongoDB Atlas connection string
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority';
        
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB Atlas');

        // Session Configuration
        app.use(session({
            secret: process.env.SESSION_SECRET || 'your_secret_key',
            resave: false,
            saveUninitialized: false,
            store: MongoStore.create({ 
                mongoUrl: MONGODB_URI,
                collectionName: 'sessions'
            }),
            cookie: {
                maxAge: 1000 * 60 * 60 * 24 // 1 day
            }
        }));

        // Passport Authentication Configuration
        configurePassport(app);

        // File Upload Configuration
        configureFileUpload(app);

        // Routes Configuration
        configureAuthRoutes(app);

    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// Configure Passport Authentication
function configurePassport(app) {
    // Initialize Passport and restore authentication state from session
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash());

    // Flash messages middleware
    app.use((req, res, next) => {
        res.locals.messages = req.flash();
        next();
    });

    // Local strategy for email/password authentication
    passport.use(new LocalStrategy(
        { usernameField: 'email' },
        async (email, password, done) => {
            try {
                // Find the user by email
                const user = await User.findOne({ email: email.toLowerCase() });
                
                // If user doesn't exist
                if (!user) {
                    return done(null, false, { message: 'Incorrect email or password' });
                }
                
                // Check password
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    return done(null, false, { message: 'Incorrect email or password' });
                }
                
                return done(null, user);
            } catch (error) {
                return done(error);
            }
        }
    ));

    // Serialize user for the session
    passport.serializeUser((user, done) => {
        done(null, user.id);
    });

    // Deserialize user from the session
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await User.findById(id);
            done(null, user);
        } catch (error) {
            done(error);
        }
    });
}

// Configure File Upload
function configureFileUpload(app) {
    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Set up storage engine
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        }
    });

    // Initialize multer with storage engine
    const upload = multer({ 
        storage: storage,
        limits: { fileSize: 5000000 }, // 5MB
        fileFilter: (req, file, cb) => {
            const filetypes = /jpeg|jpg|png|gif/;
            const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
            const mimetype = filetypes.test(file.mimetype);

            if (mimetype && extname) {
                return cb(null, true);
            } else {
                cb(new Error('Error: Images Only!'));
            }
        }
    });

    // Make upload available globally
    app.locals.upload = upload;
}

// Configure Authentication Routes
function configureAuthRoutes(app) {
    // Login route
    app.post('/auth/login', (req, res, next) => {
        passport.authenticate('local', {
            successRedirect: '/dashboard',
            failureRedirect: '/auth/login',
            failureFlash: true
        })(req, res, next);
    });

    // Register route
    app.post('/auth/register', app.locals.upload.single('avatar'), async (req, res) => {
        try {
            const { name, email, password, confirmPassword, role } = req.body;
            
            // Validate password match
            if (password !== confirmPassword) {
                req.flash('error', 'Passwords do not match');
                return res.redirect('/auth/register');
            }

            // Check if user already exists
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                req.flash('error', 'Email already registered');
                return res.redirect('/auth/register');
            }

            // Hash password
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Create new user
            const newUser = new User({
                name,
                email: email.toLowerCase(),
                password: hashedPassword,
                role: role || 'jobseeker',
                avatar: req.file ? `/uploads/${req.file.filename}` : null
            });

            await newUser.save();
            
            req.flash('success', 'Registration successful! You can now log in');
            res.redirect('/auth/login');
        } catch (error) {
            console.error(error);
            req.flash('error', 'Server error, please try again');
            res.redirect('/auth/register');
        }
    });

    // Logout route
    app.get('/auth/logout', (req, res) => {
        req.logout((err) => {
            if (err) {
                console.error(err);
                return next(err);
            }
            res.redirect('/');
        });
    });

    // Render login page
    app.get('/auth/login', (req, res) => {
        res.render('login');
    });

    // Render register page
    app.get('/auth/register', (req, res) => {
        res.render('register');
    });
}

module.exports = connectDB;