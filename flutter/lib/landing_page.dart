import 'package:flutter/material.dart';
import 'dart:ui' as ui;
import 'dart:async';
import 'package:google_fonts/google_fonts.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'tasks.dart';
import 'yield.dart';
import 'logs.dart';
import 'profile.dart';
// 
class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> with TickerProviderStateMixin {
  // Aquatic Color Palette
  final Color tealLight = const Color(0xFF5EEAD4);
  final Color teal = const Color(0xFF0D9488);
  final Color tealDark = const Color(0xFF0F766E);
  final Color seaBlue = const Color(0xFF0369A1);
  final Color deepsea = const Color(0xFF001F3F);
  
  bool _showNotificationDropdown = false;
  late GlobalKey<ScaffoldState> _scaffoldKey;

  late AnimationController _rippleController;
  late AnimationController _fadeController;

  // Firestore live data
  Map<String, dynamic> _sensorData = {};
  List<Map<String, dynamic>> _alerts = [];
  double? _expectedYield;
  String _yieldCycleLabel = '';
  String _targetHarvestDate = '';

  StreamSubscription<QuerySnapshot>? _sensorSub;
  StreamSubscription<QuerySnapshot>? _alertsSub;
  StreamSubscription<QuerySnapshot>? _yieldSub;

  @override
  void initState() {
    super.initState();
    _scaffoldKey = GlobalKey<ScaffoldState>();
    
    // Initialize ripple animation
    _rippleController = AnimationController(
      duration: const Duration(seconds: 4),
      vsync: this,
    )..repeat();

    // Initialize fade animation
    _fadeController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..forward();

    _initListeners();
  }

  @override
  void dispose() {
    _sensorSub?.cancel();
    _alertsSub?.cancel();
    _yieldSub?.cancel();
    _rippleController.dispose();
    _fadeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: Colors.white,
      drawer: _buildSidebar(context),
      appBar: _buildTopBar(context),
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
          FadeTransition(
            opacity: Tween<double>(begin: 0, end: 1).animate(
              CurvedAnimation(parent: _fadeController, curve: Curves.easeInOut),
            ),
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Greeting
                  Text(
                    "Magandang Araw!",
                    style: GoogleFonts.poppins(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    "Status ng Bantay Ulang ngayong araw.",
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      color: const Color(0xFF6B7280),
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Main Status Card
                  _buildStatusCard(),
                  const SizedBox(height: 24),

                  // Yield Prediction Section
                  _buildYieldSection(),
                  const SizedBox(height: 24),

                  // Urgent Tasks Section
                  _buildUrgentTasksSection(),
                  const SizedBox(height: 24),

                  // Water Conditions
                  Text(
                    "Kondisyon ng Tubig",
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                      letterSpacing: 0.3,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.thermostat,
                    "Temperatura",
                    _sensorVal('temperature', '°C'),
                    _sensorStatus('temperature', 26, 32),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.water_drop,
                    "pH Level",
                    _sensorVal('phLevel', ''),
                    _sensorStatus('phLevel', 7.5, 8.5),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.air,
                    "Dissolved Oxygen",
                    _sensorVal('dissolvedOxygen', 'mg/L'),
                    _sensorStatus('dissolvedOxygen', 5, 15),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.water,
                    "Water Level",
                    _sensorVal('waterLevel', 'm'),
                    _sensorStatus('waterLevel', 0, 2),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.opacity,
                    "Salinity",
                    _sensorVal('salinity', 'ppt'),
                    _sensorStatus('salinity', 0, 5),
                  ),
                  const SizedBox(height: 12),
                  _buildWaterConditionCard(
                    Icons.blur_on,
                    "Turbidity",
                    _sensorVal('turbidity', 'NTU'),
                    _sensorStatus('turbidity', 0, 50),
                  ),
                  const SizedBox(height: 24),

                  // Plant Status Section
                  Row(
                    children: [
                      Icon(Icons.eco, color: teal, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        "STATUS NG MGA TANIM",
                        style: GoogleFonts.poppins(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF0F766E),
                          letterSpacing: 0.3,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _buildPlantCard(
                    Icons.eco,
                    "Plant",
                    "Healthy and growing well.",
                    "Healthy",
                    "Growing well",
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildTopBar(BuildContext context) {
    return PreferredSize(
      preferredSize: const Size.fromHeight(60),
      child: Container(
        color: Colors.white,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Row(
            children: [
              // Menu Button
              IconButton(
                icon: const Icon(Icons.menu, color: Color(0xFF374151)),
                onPressed: () => _scaffoldKey.currentState?.openDrawer(),
              ),
              Expanded(
                child: Center(
                  child: Text(
                    "Bantay Ulang",
                    style: GoogleFonts.poppins(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                    ),
                  ),
                ),
              ),
              // Notifications
              Stack(
                clipBehavior: Clip.none,
                children: [
                  IconButton(
                    icon: const Icon(Icons.notifications_none,
                        color: Color(0xFF374151)),
                    onPressed: () {
                      setState(() {
                        _showNotificationDropdown = !_showNotificationDropdown;
                      });
                    },
                  ),
                  if (_alerts.isNotEmpty)
                    Positioned(
                      top: 12,
                      right: 12,
                      child: Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF4444),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  if (_showNotificationDropdown)
                    Positioned(
                      top: 50,
                      right: -10,
                      child: _buildNotificationDropdown(),
                    ),
                ],
              ),
              // Profile Avatar Only
              GestureDetector(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const ProfilePage()),
                  );
                },
                child: Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: tealDark,
                    borderRadius: BorderRadius.circular(50),
                  ),
                  child: const Center(
                    child: Text(
                      "JD",
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 14,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildNotificationDropdown() {
    return Container(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Notification dropdown box
          Material(
            color: Colors.transparent, // Prevents white corners from showing
            child: Container(
              width: 320,
              constraints: const BoxConstraints(maxHeight: 400),
              clipBehavior: Clip.antiAlias, // <-- THIS makes all inside corners round
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: teal.withOpacity(0.3), width: 1.5),
                borderRadius: BorderRadius.circular(16), // Increased slightly for softer look
                boxShadow: [
                  BoxShadow(
                    color: teal.withOpacity(0.2),
                    blurRadius: 16,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: teal.withOpacity(0.1)),
                      ),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 36,
                          height: 36,
                          decoration: BoxDecoration(
                            color: teal.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(50),
                          ),
                          child: Icon(Icons.notifications_active, color: teal, size: 18),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            "Mga Aktibong Alerto (${_alerts.length})",
                            style: GoogleFonts.poppins(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F766E),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: _alerts.isEmpty
                          ? [
                              Padding(
                                padding: const EdgeInsets.all(16),
                                child: Text(
                                  'Walang aktibong alerto.',
                                  style: GoogleFonts.poppins(
                                    fontSize: 13,
                                    color: const Color(0xFF6B7280),
                                  ),
                                  textAlign: TextAlign.center,
                                ),
                              ),
                            ]
                          : _alerts.take(5).map((alert) {
                              final isWarning =
                                  (alert['type'] as String? ?? '') == 'warning';
                              return _buildNotificationItem(
                                isWarning
                                    ? Icons.warning_amber_rounded
                                    : Icons.info_outline,
                                alert['title'] as String? ?? 'Alert',
                                alert['message'] as String? ?? '',
                                '',
                                isWarning
                                    ? const Color(0xFFEF4444)
                                    : const Color(0xFF0D9488),
                              );
                            }).toList(),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      border: Border(
                        top: BorderSide(color: teal.withOpacity(0.1)),
                      ),
                      // Removed manual bottom rounding here since clipBehavior handles it automatically
                    ),
                    child: Center(
                      child: Text(
                        "View All Notifications",
                        style: GoogleFonts.poppins(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: teal,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNotificationItem(
    IconData icon,
    String title,
    String message,
    String time,
    Color color,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: teal.withOpacity(0.08)),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF111827),
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: const Color(0xFF6B7280),
                    fontWeight: FontWeight.w400,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  time,
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    color: const Color(0xFF9CA3AF),
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }


  // Widget _buildProfileMenuItem(String title, BuildContext context,
  //     {bool isLogout = false}) {
  //   return Container(
  //     decoration: BoxDecoration(
  //       border: Border(
  //         bottom: BorderSide(
  //           color: const Color(0xFFF3F4F6),
  //         ),
  //       ),
  //     ),
  //     child: Material(
  //       color: Colors.transparent,
  //       child: InkWell(
  //         onTap: () {
  //           setState(() {
  //             _showProfileDropdown = false;
  //           });
  //           if (isLogout) {
  //             Navigator.pushAndRemoveUntil(
  //               context,
  //               MaterialPageRoute(builder: (context) => const LoginPage()),
  //               (route) => false,
  //             );
  //           }
  //         },
  //         child: Padding(
  //           padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
  //           child: Text(
  //             title,
  //             style: const TextStyle(
  //               fontSize: 13,
  //               color: Color(0xFF374151),
  //             ),
  //           ),
  //         ),
  //       ),
  //     ),
  //   );
  // }

  Drawer _buildSidebar(BuildContext context) {
    return Drawer(
      backgroundColor: const Color(0xFF15212E),
      child: SafeArea(
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: const BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: Color(0x14FFFFFF)),
                ),
              ),
              child: Row(
                children: [
                  // Logo
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.asset(
                      'assets/img/logo_BU.png',
                      width: 28,
                      height: 24,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) => Container(
                        width: 28,
                        height: 24,
                        decoration: BoxDecoration(
                          color: teal,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Icon(
                          Icons.water_drop,
                          color: Colors.white,
                          size: 14,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text(
                    "Bantay Ulang",
                    style: TextStyle(
                      color: Color(0xFFECF0F1),
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(
                      Icons.chevron_left,
                      color: Color(0xFF9CA3AF),
                      size: 16,
                    ),
                    onPressed: () => Navigator.pop(context),
                    padding: EdgeInsets.zero,
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.zero,
                children: [
                  _buildNavLink(
                    Icons.home,
                    "Home",
                    context,
                    isActive: true,
                  ),
                  _buildNavLink(
                    Icons.assignment_turned_in,
                    "Tasks",
                    context,
                    page: const TasksPage(),
                  ),
                  _buildNavLink(
                    Icons.show_chart,
                    "Yield",
                    context,
                    page: const YieldEstimationPage(),
                  ),
                  _buildNavLink(
                    Icons.list,
                    "Logs",
                    context,
                    page: const LogsPage(),
                  ),
                ],
              ),
            ),
            Container(
              decoration: const BoxDecoration(
                border: Border(
                  top: BorderSide(color: Color(0x14FFFFFF)),
                ),
              ),
              child: _buildNavLink(
                Icons.logout,
                "Log out",
                context,
                isLogout: true,
                isLast: true,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNavLink(
    IconData icon,
    String title,
    BuildContext context, {
    Widget? page,
    bool isActive = false,
    bool isLogout = false,
    bool isLast = false,
  }) {
    return Material(
      color: isActive ? const Color(0x40859356) : Colors.transparent,
      child: InkWell(
        onTap: () {
          Navigator.pop(context);
          if (isLogout) {
            Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
          } else if (page != null) {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => page),
            );
          }
        },
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
          decoration: BoxDecoration(
            border: Border(
              left: BorderSide(
                color: isActive ? const Color(0xFF10B981) : Colors.transparent,
                width: 3,
              ),
            ),
          ),
          child: Row(
            children: [
              Icon(
                icon,
                color: isLogout
                    ? const Color(0xFFF87171)
                    : (isActive
                        ? const Color(0xFF6EE7B7)
                        : const Color(0xFFBDC3C7)),
                size: 16,
              ),
              const SizedBox(width: 12),
              Text(
                title,
                style: TextStyle(
                  color: isLogout
                      ? const Color(0xFFF87171)
                      : (isActive
                          ? const Color(0xFF6EE7B7)
                          : const Color(0xFFBDC3C7)),
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _initListeners() {
    // Latest sensor reading from ESP32
    _sensorSub = FirebaseFirestore.instance
        .collection('sensor_readings')
        .orderBy('timestamp', descending: true)
        .limit(1)
        .snapshots()
        .listen((snap) {
      if (snap.docs.isNotEmpty && mounted) {
        setState(() => _sensorData = snap.docs.first.data() as Map<String, dynamic>);
      }
    });

    // Active alerts/warnings
    _alertsSub = FirebaseFirestore.instance
        .collection('alerts')
        .where('status', isEqualTo: 'active')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .listen((snap) {
      if (mounted) {
        setState(() => _alerts = snap.docs
            .map((d) => d.data() as Map<String, dynamic>)
            .toList());
      }
    });

    // Latest yield from growth_indicators
    _yieldSub = FirebaseFirestore.instance
        .collection('growth_indicators')
        .orderBy('timestamp', descending: true)
        .limit(1)
        .snapshots()
        .listen((snap) {
      if (snap.docs.isNotEmpty && mounted) {
        final data = snap.docs.first.data() as Map<String, dynamic>;
        final cs = _fmtDate(data['cycleStart']);
        final ce = _fmtDate(data['cycleEnd']);
        setState(() {
          _expectedYield     = (data['expectedYield'] as num?)?.toDouble();
          _yieldCycleLabel   = (cs == '—' && ce == '—') ? '' : '$cs – $ce';
          _targetHarvestDate = _fmtDate(data['targetHarvestDate']);
        });
      }
    });
  }

  // Returns the sensor value formatted with its unit, or '—' if not yet received
  String _sensorVal(String key, String unit, {int decimals = 1}) {
    final val = (_sensorData[key] as num?)?.toDouble();
    if (val == null) return '—';
    final formatted = val.toStringAsFixed(decimals);
    return unit.isEmpty ? formatted : '$formatted $unit';
  }

  // Returns NORMAL / MABABA / MATAAS based on configured thresholds
  String _sensorStatus(String key, double min, double max) {
    final val = (_sensorData[key] as num?)?.toDouble();
    if (val == null) return '—';
    if (val < min) return 'MABABA';
    if (val > max) return 'MATAAS';
    return 'NORMAL';
  }

  String _fmtDate(dynamic value) {
    if (value == null) return '—';
    if (value is Timestamp) {
      final d = value.toDate();
      const m = ['Jan','Feb','Mar','Apr','May','Jun',
                  'Jul','Aug','Sep','Oct','Nov','Dec'];
      return '${m[d.month - 1]} ${d.day}, ${d.year}';
    }
    return value.toString();
  }

  bool _isSystemHealthy() {
    if (_sensorData.isEmpty) return true;
    final ph    = (_sensorData['phLevel'] as num?)?.toDouble();
    final temp  = (_sensorData['temperature'] as num?)?.toDouble();
    final doVal = (_sensorData['dissolvedOxygen'] as num?)?.toDouble();
    final wl    = (_sensorData['waterLevel'] as num?)?.toDouble();
    if (ph    != null && (ph < 7.5 || ph > 8.5))  return false;
    if (temp  != null && (temp < 26 || temp > 32)) return false;
    if (doVal != null && doVal < 5)                return false;
    if (wl    != null && wl > 2)                   return false;
    return true;
  }

  Widget _buildStatusCard() {
    return GlassmorphicCard(
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [teal.withOpacity(0.9), tealDark.withOpacity(0.85)],
          ),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: teal.withOpacity(0.2),
              blurRadius: 15,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: Colors.white.withOpacity(0.9),
                      width: 2,
                    ),
                    borderRadius: BorderRadius.circular(50),
                  ),
                  child: Icon(
                    _isSystemHealthy() ? Icons.check : Icons.warning_amber_rounded,
                    color: Colors.white,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _sensorData.isEmpty
                            ? 'Nilo-load...'
                            : (_isSystemHealthy()
                                ? 'Mabuti ang Kalagayan'
                                : 'Kailangan ng Atensyon'),
                        style: GoogleFonts.poppins(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _sensorData.isEmpty
                            ? 'Sinusuri ang datos ng sensor...'
                            : (_isSystemHealthy()
                                ? 'Ligtas ang tubig at masigla ang mga ulang at tanim sa buong system.'
                                : 'May mga parameter na nangangailangan ng atensyon. Tingnan ang mga alerto.'),
                        style: GoogleFonts.poppins(
                          fontSize: 13,
                          color: Colors.white.withOpacity(0.95),
                          height: 1.4,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                _buildStatusSubcard("Laki ng Ulang", "Malusog"),
                const SizedBox(width: 12),
                _buildStatusSubcard("Dami ng Tanim", "Sapat"),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusSubcard(String label, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.25),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.white.withOpacity(0.3),
          ),
        ),
        child: Column(
          children: [
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
                letterSpacing: 0.04,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: GoogleFonts.poppins(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildYieldSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.show_chart, color: teal, size: 18),
            const SizedBox(width: 8),
            Text(
              "Inaasahang Ani ng Ulang",
              style: GoogleFonts.poppins(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0F766E),
                letterSpacing: 0.3,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        GlassmorphicCard(
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [seaBlue.withOpacity(0.9), tealDark.withOpacity(0.85)],
              ),
              borderRadius: BorderRadius.circular(14),
              boxShadow: [
                BoxShadow(
                  color: seaBlue.withOpacity(0.2),
                  blurRadius: 15,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.25),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: Colors.white.withOpacity(0.3),
                        ),
                      ),
                      child: const Icon(
                        Icons.pets,
                        color: Colors.white,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      "Expected yield",
                      style: GoogleFonts.poppins(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Colors.white.withOpacity(0.95),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  _expectedYield != null
                      ? '${_expectedYield!.toStringAsFixed(1)} kg'
                      : '— kg',
                  style: GoogleFonts.poppins(
                    fontSize: 32,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                    letterSpacing: -0.02,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _yieldCycleLabel.isNotEmpty
                      ? _yieldCycleLabel
                      : 'This cycle · Based on current stock & conditions',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    color: Colors.white.withOpacity(0.9),
                    fontWeight: FontWeight.w400,
                  ),
                ),
                if (_targetHarvestDate.isNotEmpty && _targetHarvestDate != '—') ...[
                  const SizedBox(height: 2),
                  Text(
                    'Target harvest: $_targetHarvestDate',
                    style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: Colors.white.withOpacity(0.8),
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                Text(
                  "Prediction may change with feeding, water quality, and survival rate. Keep logs updated for better estimates.",
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.85),
                    height: 1.4,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildUrgentTasksSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.flash_on, color: Color(0xFFDC2626), size: 18),
            const SizedBox(width: 8),
            Text(
              "Urgent Tasks",
              style: GoogleFonts.poppins(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0F766E),
                letterSpacing: 0.3,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        // Urgent task card
        GlassmorphicCard(
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.6),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: Colors.white.withOpacity(0.5),
              ),
              boxShadow: [
                BoxShadow(
                  color: teal.withOpacity(0.1),
                  blurRadius: 10,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.water_drop,
                        color: Color(0xFFDC2626),
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            "Ulang Data Capture",
                            style: GoogleFonts.poppins(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0F766E),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            "Due: March 06 · Assigned by Admin",
                            style: GoogleFonts.poppins(
                              fontSize: 12,
                              color: const Color(0xFF6B7280),
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFEF2F2),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              "URGENT",
                              style: GoogleFonts.poppins(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFFB91C1C),
                                letterSpacing: 0.02,
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                          GestureDetector(
                            onTap: () {
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (context) => const TasksPage(),
                                ),
                              );
                            },
                            child: Row(
                              children: [
                                Text(
                                  "View task",
                                  style: GoogleFonts.poppins(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: teal,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Icon(
                                  Icons.arrow_forward,
                                  color: teal,
                                  size: 14,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        GestureDetector(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (context) => const TasksPage()),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [teal, tealDark],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(10),
              boxShadow: [
                BoxShadow(
                  color: teal.withOpacity(0.3),
                  blurRadius: 10,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.assignment, color: Colors.white, size: 16),
                const SizedBox(width: 8),
                Text(
                  "View all my tasks",
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildWaterConditionCard(
    IconData icon,
    String title,
    String description,
    String status,
  ) {
    return GlassmorphicCard(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.6),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: Colors.white.withOpacity(0.5),
          ),
          boxShadow: [
            BoxShadow(
              color: teal.withOpacity(0.1),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: tealLight.withOpacity(0.8),
                borderRadius: BorderRadius.circular(50),
                border: Border.all(
                  color: tealLight.withOpacity(0.5),
                ),
              ),
              child: Icon(icon, color: teal, size: 18),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: GoogleFonts.poppins(
                      fontSize: 13,
                      color: const Color(0xFF6B7280),
                      height: 1.35,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
            Text(
              status,
              style: GoogleFonts.poppins(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF6B7280),
                letterSpacing: 0.03,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlantCard(
    IconData icon,
    String title,
    String description,
    String statusValue,
    String statusLabel,
  ) {
    return GlassmorphicCard(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.6),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: Colors.white.withOpacity(0.5),
          ),
          boxShadow: [
            BoxShadow(
              color: teal.withOpacity(0.1),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: tealLight.withOpacity(0.8),
                borderRadius: BorderRadius.circular(50),
                border: Border.all(
                  color: tealLight.withOpacity(0.5),
                ),
              ),
              child: Icon(icon, color: teal, size: 18),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    description,
                    style: GoogleFonts.poppins(
                      fontSize: 13,
                      color: const Color(0xFF6B7280),
                      height: 1.35,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  statusValue,
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF0F766E),
                    letterSpacing: 0.03,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  statusLabel,
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: const Color(0xFF6B7280),
                    letterSpacing: 0.03,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ],
            ),
          ],
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
        child: child,
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


