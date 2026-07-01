import 'package:flutter/material.dart';
import 'dart:ui' as ui;
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'landing_page.dart';

class SignupPage extends StatefulWidget {
  const SignupPage({super.key});

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> with TickerProviderStateMixin {
  // Color Palette - Aquatic Theme
  final Color tealLight = const Color(0xFF5EEAD4);
  final Color teal = const Color(0xFF0D9488);
  final Color tealDark = const Color(0xFF0F766E);
  final Color seaBlue = const Color(0xFF0369A1);
  final Color deepsea = const Color(0xFF001F3F);
  
  bool isSignIn = true;
  bool isPasswordVisible = false;
  bool isConfirmPasswordVisible = false;
  bool rememberMe = false;
  bool _isLoading = false;
  String errorMessage = '';

  late AnimationController _fadeController;
  late AnimationController _slideController;
  late AnimationController _rippleController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  final confirmPasswordController = TextEditingController();
  final nameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    
    // Initialize animations
    _fadeController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    );

    _slideController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );

    _rippleController = AnimationController(
      duration: const Duration(seconds: 4),
      vsync: this,
    )..repeat();

    _fadeAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _fadeController, curve: Curves.easeInOut),
    );

    _slideAnimation = Tween<Offset>(begin: const Offset(0, 0.5), end: Offset.zero).animate(
      CurvedAnimation(parent: _slideController, curve: Curves.easeOutCubic),
    );

    _fadeController.forward();
    _slideController.forward();
  }

  @override
  void dispose() {
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    nameController.dispose();
    _fadeController.dispose();
    _slideController.dispose();
    _rippleController.dispose();
    super.dispose();
  }

  Future<void> _handleSignIn() async {
    setState(() { errorMessage = ''; _isLoading = true; });

    if (emailController.text.trim().isEmpty || passwordController.text.isEmpty) {
      setState(() { errorMessage = 'Please enter email and password.'; _isLoading = false; });
      return;
    }

    try {
      final credential = await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: emailController.text.trim(),
        password: passwordController.text,
      );

      final doc = await FirebaseFirestore.instance
          .collection('users')
          .doc(credential.user!.uid)
          .get();

      final role = doc.data()?['role'] ?? 'user';

      if (!mounted) return;
      setState(() => _isLoading = false);

      if (role == 'admin') {
        setState(() => errorMessage = 'Admin access is only available on the web portal.');
        await FirebaseAuth.instance.signOut();
      } else {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (context) => const DashboardPage()),
        );
      }
    } on FirebaseAuthException catch (e) {
      setState(() { errorMessage = _authErrorMessage(e.code); _isLoading = false; });
    }
  }

  Future<void> _handleSignUp() async {
    setState(() { errorMessage = ''; _isLoading = true; });

    if (nameController.text.trim().isEmpty ||
        emailController.text.trim().isEmpty ||
        passwordController.text.isEmpty ||
        confirmPasswordController.text.isEmpty) {
      setState(() { errorMessage = 'Please fill in all fields.'; _isLoading = false; });
      return;
    }

    if (passwordController.text != confirmPasswordController.text) {
      setState(() { errorMessage = 'Passwords do not match.'; _isLoading = false; });
      return;
    }

    try {
      final credential = await FirebaseAuth.instance.createUserWithEmailAndPassword(
        email: emailController.text.trim(),
        password: passwordController.text,
      );

      await FirebaseFirestore.instance
          .collection('users')
          .doc(credential.user!.uid)
          .set({
        'email': emailController.text.trim(),
        'fullName': nameController.text.trim(),
        'role': 'user',
        'status': 'active',
        'createdAt': FieldValue.serverTimestamp(),
      });

      if (!mounted) return;
      emailController.clear();
      passwordController.clear();
      confirmPasswordController.clear();
      nameController.clear();
      setState(() {
        isSignIn = true;
        _isLoading = false;
        errorMessage = 'Account created successfully! Please sign in.';
      });
    } on FirebaseAuthException catch (e) {
      setState(() { errorMessage = _authErrorMessage(e.code); _isLoading = false; });
    }
  }

  String _authErrorMessage(String code) {
    switch (code) {
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'Invalid email or password.';
      case 'email-already-in-use':
        return 'An account with this email already exists.';
      case 'weak-password':
        return 'Password must be at least 6 characters.';
      case 'invalid-email':
        return 'Please enter a valid email address.';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  void _clearForm() {
    emailController.clear();
    passwordController.clear();
    confirmPasswordController.clear();
    nameController.clear();
    setState(() => errorMessage = '');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          // Animated water ripple background
          AnimatedBuilder(
            animation: _rippleController,
            builder: (context, child) => WaterRippleBackground(
              animation: _rippleController.value,
              tealLight: tealLight,
              teal: teal,
              deepsea: deepsea,
            ),
          ),

          // Gradient overlay
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  teal.withOpacity(0.05),
                  seaBlue.withOpacity(0.03),
                ],
              ),
            ),
          ),

          // Main content
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
              child: Center(
                child: FadeTransition(
                  opacity: _fadeAnimation,
                  child: SlideTransition(
                    position: _slideAnimation,
                    child: SizedBox(
                      width: double.infinity,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 420),
                        child: GlassmorphicCard(
                          child: Column(
                            children: [
                              // Auth Toggle with enhanced styling
                              _buildAuthToggle(),
                              const SizedBox(height: 32),

                              // Title and Subtitle
                              Text(
                                isSignIn ? 'Welcome Back' : 'Create Account',
                                style: GoogleFonts.poppins(
                                  fontSize: 32,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0F766E),
                                  letterSpacing: -0.5,
                                ),
                              ),
                              const SizedBox(height: 10),
                              Text(
                                isSignIn
                                    ? 'Log in to your Bantay Ulang account'
                                    : 'Join Bantay Ulang today',
                                style: GoogleFonts.poppins(
                                  fontSize: 14,
                                  color: const Color(0xFF6B7280),
                                  fontWeight: FontWeight.w400,
                                  letterSpacing: 0.3,
                                ),
                              ),
                              const SizedBox(height: 32),

                              // Name Field (Sign Up only)
                              if (!isSignIn) ...[
                                _buildFormGroup(
                                  label: 'Full Name',
                                  icon: Icons.person_outline,
                                  controller: nameController,
                                  hintText: 'John Doe',
                                ),
                                const SizedBox(height: 22),
                              ],

                              // Email Field
                              _buildFormGroup(
                                label: 'Email Address',
                                icon: Icons.email_outlined,
                                controller: emailController,
                                hintText: 'you@example.com',
                              ),
                              const SizedBox(height: 22),

                              // Password Field
                              _buildPasswordField(
                                label: 'Password',
                                controller: passwordController,
                                isVisible: isPasswordVisible,
                                onToggle: () {
                                  setState(() => isPasswordVisible = !isPasswordVisible);
                                },
                                hintText: 'Enter your password',
                              ),
                              const SizedBox(height: 22),

                              // Confirm Password Field (Sign Up only)
                              if (!isSignIn) ...[
                                _buildPasswordField(
                                  label: 'Confirm Password',
                                  controller: confirmPasswordController,
                                  isVisible: isConfirmPasswordVisible,
                                  onToggle: () {
                                    setState(() =>
                                        isConfirmPasswordVisible = !isConfirmPasswordVisible);
                                  },
                                  hintText: 'Confirm your password',
                                ),
                                const SizedBox(height: 22),
                              ],

                              // Remember Me and Forgot Password (Sign In only)
                              if (isSignIn) ...[
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    GestureDetector(
                                      onTap: () =>
                                          setState(() => rememberMe = !rememberMe),
                                      child: Row(
                                        children: [
                                          Container(
                                            width: 20,
                                            height: 20,
                                            decoration: BoxDecoration(
                                              border: Border.all(
                                                color: rememberMe ? teal : const Color(0xFFD1D5DB),
                                                width: 2,
                                              ),
                                              borderRadius: BorderRadius.circular(4),
                                              color: rememberMe ? teal : Colors.transparent,
                                            ),
                                            child: rememberMe
                                                ? Icon(Icons.check,
                                                    size: 14,
                                                    color: Colors.white,
                                                    semanticLabel: 'Selected')
                                                : null,
                                          ),
                                          const SizedBox(width: 10),
                                          Text(
                                            'Remember me',
                                            style: GoogleFonts.poppins(
                                              fontSize: 14,
                                              color: const Color(0xFF111827),
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                    GestureDetector(
                                      onTap: () {},
                                      child: Text(
                                        'Forgot password?',
                                        style: GoogleFonts.poppins(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: teal,
                                          decoration: TextDecoration.none,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 28),
                              ] else
                                const SizedBox(height: 28),

                              // Submit Button with gradient
                              _buildSubmitButton(),

                              // Error Message
                              if (errorMessage.isNotEmpty) ...[
                                const SizedBox(height: 16),
                                Container(
                                  padding: const EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFEE2E2),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: const Color(0xFFFECACA),
                                    ),
                                  ),
                                  child: Text(
                                    errorMessage,
                                    style: GoogleFonts.poppins(
                                      fontSize: 13,
                                      color: const Color(0xFFDC2626),
                                      fontWeight: FontWeight.w500,
                                    ),
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAuthToggle() {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Colors.white.withOpacity(0.8),
            Colors.white.withOpacity(0.6),
          ],
        ),
        border: Border.all(
          color: Colors.white.withOpacity(0.5),
          width: 1.5,
        ),
        borderRadius: BorderRadius.circular(50),
      ),
      padding: const EdgeInsets.all(6),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() => isSignIn = true);
                _clearForm();
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  gradient: isSignIn
                      ? LinearGradient(
                          colors: [teal, tealDark],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        )
                      : null,
                  borderRadius: BorderRadius.circular(50),
                  boxShadow: isSignIn
                      ? [
                          BoxShadow(
                            color: teal.withOpacity(0.3),
                            blurRadius: 15,
                            offset: const Offset(0, 4),
                          )
                        ]
                      : [],
                ),
                child: Text(
                  'Log In',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: isSignIn ? Colors.white : const Color(0xFF6B7280),
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() => isSignIn = false);
                _clearForm();
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  gradient: !isSignIn
                      ? LinearGradient(
                          colors: [teal, tealDark],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        )
                      : null,
                  borderRadius: BorderRadius.circular(50),
                  boxShadow: !isSignIn
                      ? [
                          BoxShadow(
                            color: teal.withOpacity(0.3),
                            blurRadius: 15,
                            offset: const Offset(0, 4),
                          )
                        ]
                      : [],
                ),
                child: Text(
                  'Sign Up',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: !isSignIn ? Colors.white : const Color(0xFF6B7280),
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormGroup({
    required String label,
    required IconData icon,
    required TextEditingController controller,
    required String hintText,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF0F766E),
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: teal.withOpacity(0.08),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: TextField(
            controller: controller,
            style: GoogleFonts.poppins(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: const Color(0xFF111827),
            ),
            decoration: InputDecoration(
              hintText: hintText,
              hintStyle: GoogleFonts.poppins(
                fontSize: 15,
                color: const Color(0xFF9CA3AF),
                fontWeight: FontWeight.w400,
              ),
              prefixIcon: Padding(
                padding: const EdgeInsets.only(left: 16, right: 12),
                child: Icon(icon, color: teal, size: 20),
              ),
              prefixIconConstraints: const BoxConstraints(
                minWidth: 0,
                minHeight: 0,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: const Color(0xFFE5E7EB),
                  width: 1.5,
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: const Color(0xFFE5E7EB),
                  width: 1.5,
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: teal,
                  width: 2,
                ),
              ),
              filled: true,
              fillColor: Colors.white.withOpacity(0.95),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPasswordField({
    required String label,
    required TextEditingController controller,
    required bool isVisible,
    required VoidCallback onToggle,
    required String hintText,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF0F766E),
            letterSpacing: 0.3,
          ),
        ),
        const SizedBox(height: 10),
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: teal.withOpacity(0.08),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: TextField(
            controller: controller,
            obscureText: !isVisible,
            style: GoogleFonts.poppins(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: const Color(0xFF111827),
            ),
            decoration: InputDecoration(
              hintText: hintText,
              hintStyle: GoogleFonts.poppins(
                fontSize: 15,
                color: const Color(0xFF9CA3AF),
                fontWeight: FontWeight.w400,
              ),
              prefixIcon: Padding(
                padding: const EdgeInsets.only(left: 16, right: 12),
                child: Icon(Icons.lock_outline, color: teal, size: 20),
              ),
              prefixIconConstraints: const BoxConstraints(
                minWidth: 0,
                minHeight: 0,
              ),
              suffixIcon: GestureDetector(
                onTap: onToggle,
                child: Padding(
                  padding: const EdgeInsets.only(right: 16),
                  child: Icon(
                    isVisible ? Icons.visibility : Icons.visibility_off,
                    color: const Color(0xFF9CA3AF),
                    size: 20,
                  ),
                ),
              ),
              suffixIconConstraints: const BoxConstraints(
                minWidth: 0,
                minHeight: 0,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: const Color(0xFFE5E7EB),
                  width: 1.5,
                ),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: const Color(0xFFE5E7EB),
                  width: 1.5,
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide(
                  color: teal,
                  width: 2,
                ),
              ),
              filled: true,
              fillColor: Colors.white.withOpacity(0.95),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSubmitButton() {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: LinearGradient(
          colors: [teal, tealDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: teal.withOpacity(0.4),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: _isLoading ? null : (isSignIn ? _handleSignIn : _handleSignUp),
          borderRadius: BorderRadius.circular(14),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Center(
              child: _isLoading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 2.5,
                      ),
                    )
                  : Text(
                      isSignIn ? 'Log In' : 'Sign Up',
                      style: GoogleFonts.poppins(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                        letterSpacing: 0.5,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

// Custom Glassmorphic Card Widget
class GlassmorphicCard extends StatelessWidget {
  final Widget child;

  const GlassmorphicCard({
    super.key,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withOpacity(0.85),
                Colors.white.withOpacity(0.75),
              ],
            ),
            border: Border.all(
              color: Colors.white.withOpacity(0.6),
              width: 1.5,
            ),
            borderRadius: BorderRadius.circular(28),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF0D9488).withOpacity(0.15),
                blurRadius: 30,
                offset: const Offset(0, 10),
                spreadRadius: 2,
              ),
              BoxShadow(
                color: const Color(0xFF001F3F).withOpacity(0.05),
                blurRadius: 60,
                offset: const Offset(0, 30),
              ),
            ],
          ),
          padding: const EdgeInsets.all(32),
          child: child,
        ),
      ),
    );
  }
}

// Custom Water Ripple Background Widget
class WaterRippleBackground extends StatelessWidget {
  final double animation;
  final Color tealLight;
  final Color teal;
  final Color deepsea;

  const WaterRippleBackground({
    super.key,
    required this.animation,
    required this.tealLight,
    required this.teal,
    required this.deepsea,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.white,
            teal.withOpacity(0.08),
            tealLight.withOpacity(0.05),
          ],
          stops: const [0.0, 0.6, 1.0],
        ),
      ),
      child: Stack(
        children: [
          // Animated ripple circles
          Positioned(
            top: 60,
            right: 40,
            child: _buildRippleCircle(
              radius: 80 + (animation * 40),
              opacity: (1 - animation) * 0.1,
              color: tealLight,
            ),
          ),
          Positioned(
            bottom: 100,
            left: 30,
            child: _buildRippleCircle(
              radius: 120 + (animation * 50),
              opacity: (1 - animation) * 0.08,
              color: teal,
            ),
          ),
          Positioned(
            top: 200,
            left: 100,
            child: _buildRippleCircle(
              radius: 60 + (animation * 30),
              opacity: (1 - animation) * 0.06,
              color: deepsea,
            ),
          ),
          Positioned(
            bottom: 300,
            right: 100,
            child: _buildRippleCircle(
              radius: 100 + (animation * 45),
              opacity: (1 - animation) * 0.07,
              color: teal,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRippleCircle({
    required double radius,
    required double opacity,
    required Color color,
  }) {
    return Container(
      width: radius * 2,
      height: radius * 2,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(opacity),
            blurRadius: 40,
            spreadRadius: 20,
          ),
        ],
      ),
    );
  }
}
