import 'package:flutter/material.dart';
import 'dart:ui' as ui;
import 'dart:async';
import 'package:google_fonts/google_fonts.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'landing_page.dart';
import 'tasks.dart';
import 'logs.dart';
import 'profile.dart';

class YieldEstimationPage extends StatefulWidget {
  const YieldEstimationPage({super.key});

  @override
  State<YieldEstimationPage> createState() => _YieldEstimationPageState();
}

class _YieldEstimationPageState extends State<YieldEstimationPage> with TickerProviderStateMixin {
  // Aquatic Color Palette
  final Color tealLight = const Color(0xFF5EEAD4);
  final Color teal = const Color(0xFF0D9488);
  final Color tealDark = const Color(0xFF0F766E);
  final Color seaBlue = const Color(0xFF0369A1);
  final Color deepsea = const Color(0xFF001F3F);

  late GlobalKey<ScaffoldState> _scaffoldKey;
  late AnimationController _fadeController;

  // Live data from growth_indicators
  double? _expectedYield;
  double? _avgWeight;
  double? _survivalRate;
  double? _growthRate;
  double? _biomassEstimate;
  String _cycleLabel = '';
  String _targetHarvest = '';
  String _summaryNote = '';
  String _generatedBy = '';
  bool _isLoading = true;
  StreamSubscription<QuerySnapshot>? _yieldSub;

  @override
  void initState() {
    super.initState();
    _scaffoldKey = GlobalKey<ScaffoldState>();
    
    _fadeController = AnimationController(
      duration: const Duration(milliseconds: 1000),
      vsync: this,
    )..forward();

    _initListener();
  }

  @override
  void dispose() {
    _yieldSub?.cancel();
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
      body: FadeTransition(
        opacity: Tween<double>(begin: 0, end: 1).animate(
          CurvedAnimation(parent: _fadeController, curve: Curves.easeInOut),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                "Yield Estimations",
                style: GoogleFonts.poppins(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF0F766E),
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                "Expected harvest and total yield of Ulang based on current data.",
                style: GoogleFonts.poppins(
                  fontSize: 14,
                  color: const Color(0xFF6B7280),
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 24),

              // Expected Harvest Section
              _buildSectionTitle(Icons.set_meal, "Expected harvest"),
              const SizedBox(height: 12),
              _buildHighlightCard(),
              const SizedBox(height: 24),

              // Total Yield Section
              _buildSectionTitle(Icons.scale, "Total yield"),
              const SizedBox(height: 12),
              _buildYieldCard(),
              const SizedBox(height: 12),
              _buildSummaryRow(
                "Avg. weight per piece",
                _isLoading
                    ? '...'
                    : (_avgWeight != null
                        ? '~${_avgWeight!.toStringAsFixed(0)} g'
                        : '—'),
              ),
              const SizedBox(height: 10),
              _buildSummaryRow(
                "Cycle period",
                _val(_cycleLabel.isNotEmpty ? _cycleLabel : null),
              ),
              const SizedBox(height: 10),
              _buildSummaryRow(
                "Survival rate",
                _isLoading
                    ? '...'
                    : (_survivalRate != null
                        ? '${_survivalRate!.toStringAsFixed(1)}%'
                        : '—'),
              ),
              const SizedBox(height: 10),
              _buildSummaryRow(
                "Growth rate",
                _isLoading
                    ? '...'
                    : (_growthRate != null
                        ? '${_growthRate!.toStringAsFixed(2)} g/day'
                        : '—'),
              ),
              const SizedBox(height: 10),
              _buildSummaryRow(
                "Biomass estimate",
                _isLoading
                    ? '...'
                    : (_biomassEstimate != null
                        ? '${_biomassEstimate!.toStringAsFixed(1)} kg'
                        : '—'),
              ),
              const SizedBox(height: 24),

              // Summary Section
              _buildSectionTitle(Icons.info_outline, "Summary"),
              const SizedBox(height: 12),
              _buildTrendCard(),
            ],
          ),
        ),
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
                    page: const DashboardPage(),
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
                    isActive: true,
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
  }) {
    return Material(
      color: isActive ? const Color(0x40859356) : Colors.transparent,
      child: InkWell(
        onTap: () {
          Navigator.pop(context);
          if (isLogout) {
            Navigator.pushNamedAndRemoveUntil(context, '/login', (route) => false);
          } else if (page != null) {
            Navigator.pushReplacement(
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

  void _initListener() {
    _yieldSub = FirebaseFirestore.instance
        .collection('growth_indicators')
        .orderBy('timestamp', descending: true)
        .limit(1)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      if (snap.docs.isEmpty) {
        setState(() => _isLoading = false);
        return;
      }
      final data = snap.docs.first.data() as Map<String, dynamic>;
      setState(() {
        _expectedYield   = (data['expectedYield']     as num?)?.toDouble();
        _avgWeight       = (data['avgWeightPerPiece'] as num?)?.toDouble();
        _survivalRate    = (data['survivalRate']       as num?)?.toDouble();
        _growthRate      = (data['growthRate']         as num?)?.toDouble();
        _biomassEstimate = (data['biomassEstimate']    as num?)?.toDouble();
        _cycleLabel      = _buildCycleLabel(data);
        _targetHarvest   = _buildTargetHarvest(data);
        _summaryNote     = data['summaryNote']   as String? ?? '';
        _generatedBy     = data['generatedBy']   as String? ?? '';
        _isLoading       = false;
      });
    });
  }

  // Formats a Firestore Timestamp or falls back to a plain string field.
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

  String _buildCycleLabel(Map<String, dynamic> data) {
    final s = _fmtDate(data['cycleStart']);
    final e = _fmtDate(data['cycleEnd']);
    return (s == '—' && e == '—') ? '—' : '$s – $e';
  }

  String _buildTargetHarvest(Map<String, dynamic> data) {
    return _fmtDate(data['targetHarvestDate']);
  }

  // Returns the value string or '...' while still loading.
  String _val(String? value) => _isLoading ? '...' : (value ?? '—');

  Widget _buildSectionTitle(IconData icon, String title) {
    return Row(
      children: [
        Icon(icon, size: 18, color: teal),
        const SizedBox(width: 8),
        Text(
          title,
          style: GoogleFonts.poppins(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF0F766E),
            letterSpacing: 0.3,
          ),
        ),
      ],
    );
  }

  Widget _buildHighlightCard() {
    return GlassmorphicCard(
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
            Text(
              "Expected yield this cycle",
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _isLoading
                  ? '...'
                  : (_expectedYield != null
                      ? '${_expectedYield!.toStringAsFixed(1)} kg'
                      : '—'),
              style: GoogleFonts.poppins(
                fontSize: 36,
                fontWeight: FontWeight.w800,
                color: Colors.white,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              _isLoading
                  ? '...'
                  : (_targetHarvest.isNotEmpty
                      ? 'Target harvest: $_targetHarvest'
                      : 'Target harvest: —'),
              style: GoogleFonts.poppins(
                fontSize: 13,
                color: Colors.white.withOpacity(0.85),
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              height: 1,
              color: Colors.white.withOpacity(0.2),
            ),
            const SizedBox(height: 12),
            Text(
              "Based on current stock, growth rate, and typical survival. Update logs regularly for better accuracy.",
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
    );
  }

  Widget _buildYieldCard() {
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Total yield (this cycle)",
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF6B7280),
                letterSpacing: 0.3,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _isLoading
                  ? '...'
                  : (_expectedYield != null
                      ? '${_expectedYield!.toStringAsFixed(1)} kg'
                      : '—'),
              style: GoogleFonts.poppins(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF0F766E),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              "Estimated total harvest weight",
              style: GoogleFonts.poppins(
                fontSize: 13,
                color: const Color(0xFF6B7280),
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value) {
    return GlassmorphicCard(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.6),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: Colors.white.withOpacity(0.5),
          ),
          boxShadow: [
            BoxShadow(
              color: teal.withOpacity(0.08),
              blurRadius: 8,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: const Color(0xFF6B7280),
              ),
            ),
            Text(
              value,
              style: GoogleFonts.poppins(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0F766E),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTrendCard() {
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
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: teal.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.trending_up, color: teal, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    "Yield trend",
                    style: GoogleFonts.poppins(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F766E),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _isLoading
                        ? '...'
                        : (_summaryNote.isNotEmpty
                            ? _summaryNote
                            : 'Current estimate is within normal range for your setup. Keep water quality and feeding consistent to meet or exceed this yield.'),
                    style: GoogleFonts.poppins(
                      fontSize: 13,
                      color: const Color(0xFF6B7280),
                      height: 1.4,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                  if (!_isLoading && _generatedBy.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Generated by: $_generatedBy',
                      style: GoogleFonts.poppins(
                        fontSize: 11,
                        color: const Color(0xFF9CA3AF),
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ],
              ),
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


