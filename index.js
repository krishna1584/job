const express = require('express');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const flash = require('connect-flash');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const MongoStore = require('connect-mongo');
const fs = require('fs');

// Load User model with corrected path
const User = require('./views/auth/models/User.js');

// Load environment variables
dotenv.config();

// Create Express application
const app = express();
const port = process.env.PORT || 3000;

// Request Pipeline Explanation:
// 1. Client sends request
// 2. Global middleware (logging, body parsing, etc.)
// 3. Route-specific middleware (auth, validation, etc.)
// 4. Route handler
// 5. Response sent back to client
// 6. Error handling middleware (if any errors occur)

// Custom logging middleware - demonstrates request flow
app.use((req, res, next) => {
    const start = Date.now();
    // Non-blocking operation: using res.on('finish')
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${duration}ms`);
    });
    next();
});

// Global Middleware Setup
app.use(bodyParser.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(bodyParser.json()); // Parse JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files

// Template Engine Configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// MongoDB Atlas Connection
async function connectDB() {
    try {
        // Replace with your MongoDB Atlas connection string from .env
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority';
        
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB Atlas');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}

// Initialize MongoDB connection
connectDB();

// Session middleware with MongoDB store
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority',
        collectionName: 'sessions'
    }),
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Initialize Passport and Flash
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Global variables for templates
app.use((req, res, next) => {
    res.locals.user = req.user || null;
    res.locals.messages = {
        error: req.flash('error'),
        success: req.flash('success')
    };
    next();
});

// Passport configuration
passport.use(new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
        try {
            // Find user by email
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

// Serialize and deserialize user
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error);
    }
});

// Create upload directories if they don't exist
const uploadDirs = ['public/uploads/resumes', 'public/uploads/avatars'];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Async operation: directory selection
        const uploadPath = file.fieldname === 'resume' ? 'public/uploads/resumes' : 'public/uploads/avatars';
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        // Async operation: filename generation
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        // Validate file types
        const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// In-memory data store for jobs and applications
// User data is now stored in MongoDB
let jobs = [];
let applications = [];

// Authentication middleware
const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    req.flash('error', 'Please sign in to continue');
    res.redirect('/auth/login');
};

// Example of a custom validator middleware
const validateJob = (req, res, next) => {
    const { title, company, description } = req.body;
    const errors = [];

    if (!title || title.length < 3) errors.push('Title must be at least 3 characters');
    if (!company) errors.push('Company name is required');
    if (!description || description.length < 10) errors.push('Description must be at least 10 characters');

    if (errors.length > 0) {
        req.flash('error', errors);
        return res.redirect('/employer/post-job');
    }
    next();
};

// Routes with creative template usage
app.get('/', async (req, res) => {
    try {
        // Demonstrate non-blocking async operation
        const userJobs = await new Promise(resolve => {
            setTimeout(() => {
                resolve(jobs.filter(job => !req.user || job.userId === req.user.id));
            }, 100);
        });

        res.render('index', { 
            jobs: userJobs,
            pageTitle: 'Welcome to Job Portal',
            features: [
                { icon: 'search', title: 'Easy Job Search', description: 'Find relevant jobs instantly' },
                { icon: 'file-upload', title: 'Quick Apply', description: 'One-click application process' },
                { icon: 'bell', title: 'Job Alerts', description: 'Get notified about new opportunities' }
            ]
        });
    } catch (error) {
        next(error);
    }
});

// About page with dynamic content
app.get('/about', async (req, res) => {
    try {
        // Get user count from MongoDB
        const userCount = await User.countDocuments();
        
        res.render('about', {
            pageTitle: 'About Us',
            stats: {
                users: userCount,
                jobs: jobs.length,
                applications: applications.length
            }
        });
    } catch (error) {
        next(error);
    }
});

// Contact page with form handling
app.get('/contact', (req, res) => {
    res.render('contact', {
        pageTitle: 'Contact Us',
        contactInfo: {
            email: 'support@jobportal.com',
            phone: '+1 (555) 123-4567',
            address: '123 Job Street, Career City'
        }
    });
});

// Demonstrate proper async/await error handling
app.post('/contact', async (req, res, next) => {
    try {
        // Simulate async operation (e.g., sending email)
        await new Promise((resolve, reject) => {
            setTimeout(() => {
                if (Math.random() > 0.1) { // 90% success rate
                    resolve();
                } else {
                    reject(new Error('Failed to send message'));
                }
            }, 1000);
        });

        req.flash('success', 'Message sent successfully!');
        res.redirect('/contact');
    } catch (error) {
        next(error);
    }
});

// Auth routes
app.get('/auth/login', (req, res) => {
    res.render('login', { pageTitle: 'Sign In' });
});

app.post('/auth/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/',
        failureRedirect: '/auth/login',
        failureFlash: true
    })(req, res, next);
});

app.get('/auth/register', (req, res) => {
    res.render('register', { pageTitle: 'Create Account' });
});

app.post('/auth/register', upload.single('avatar'), async (req, res, next) => {
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
            avatar: req.file ? `/uploads/avatars/${req.file.filename}` : '/images/default-avatar.png'
        });

        await newUser.save();
        
        req.flash('success', 'Registration successful! You can now log in');
        res.redirect('/auth/login');
    } catch (error) {
        next(error);
    }
});

app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        res.redirect('/');
    });
});

// Job routes with validation middleware
app.get('/employer/post-job', isAuthenticated, (req, res) => {
    res.render('post-job', { pageTitle: 'Post a Job' });
});

app.post('/employer/post-job', [isAuthenticated, validateJob], async (req, res, next) => {
    try {
        const job = {
            id: Date.now(),
            userId: req.user.id,
            title: req.body.title,
            company: req.body.company,
            description: req.body.description,
            requirements: req.body.requirements,
            location: req.body.location,
            createdAt: new Date()
        };
        
        // Simulate async database operation
        await new Promise(resolve => setTimeout(resolve, 100));
        jobs.push(job);
        
        req.flash('success', 'Job posted successfully!');
        res.redirect('/jobs');
    } catch (error) {
        next(error);
    }
});

// Job search with pagination - demonstrates query handling
app.get('/jobs', async (req, res, next) => {
    try {
        const { search, location, page = 1 } = req.query;
        const limit = 10;
        const skip = (page - 1) * limit;

        let filteredJobs = jobs;
        
        if (search) {
            filteredJobs = filteredJobs.filter(job => 
                job.title.toLowerCase().includes(search.toLowerCase()) ||
                job.description.toLowerCase().includes(search.toLowerCase())
            );
        }
        
        if (location) {
            filteredJobs = filteredJobs.filter(job => 
                job.location.toLowerCase().includes(location.toLowerCase())
            );
        }

        // Pagination
        const totalJobs = filteredJobs.length;
        const totalPages = Math.ceil(totalJobs / limit);
        filteredJobs = filteredJobs.slice(skip, skip + limit);

        res.render('jobs', { 
            jobs: filteredJobs,
            pageTitle: 'Browse Jobs',
            pagination: {
                current: page,
                total: totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });
    } catch (error) {
        next(error);
    }
});

// Dashboard middleware - protect routes
app.get('/dashboard', isAuthenticated, (req, res) => {
    res.render('dashboard', { 
        user: req.user,
        pageTitle: 'Your Dashboard'
    });
});

// Custom error handler middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    // Handle specific types of errors
    if (err instanceof multer.MulterError) {
        req.flash('error', 'File upload error: ' + err.message);
        return res.redirect('back');
    }

    // Log error for monitoring
    console.error(new Date().toISOString(), err);

    // Render error page with appropriate status
    res.status(err.status || 500).render('error', { 
        error: process.env.NODE_ENV === 'production' 
            ? 'Something went wrong!' 
            : err.message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
        pageTitle: 'Error'
    });
});

// 404 handler - must be last middleware
app.use((req, res) => {
    res.status(404).render('error', { 
        error: 'Page not found',
        pageTitle: '404 Not Found'
    });
});

// Start server
app.listen(port, () => {
    console.log(`Job Portal running at http://localhost:${port}`);
});