import 'package:flutter/material.dart';
import 'dart:ui' as ui;
import 'dart:async';
import 'dart:math';
import 'package:google_fonts/google_fonts.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'landing_page.dart';
import 'tasks.dart';
import 'yield.dart';
import 'profile.dart';

class LogsPage extends StatefulWidget {
  const LogsPage({Key? key}) : super(key: key);

  @override
  State<LogsPage> createState() => _LogsPageState();
}

class _LogsPageState extends State<LogsPage> with TickerProviderStateMixin {
  // Aquatic Color Palette
  final Color tealLight = const Color(0xFF5EEAD4);
  final Color teal = const Color(0xFF0D9488);
  final Color tealDark = const Color(0xFF0F766E);
  final Color seaBlue = const Color(0xFF0369A1);
  final Color deepsea = const Color(0xFF001F3F);

  late GlobalKey<ScaffoldState> _scaffoldKey;
  late AnimationController _fadeController;

  List<Map<String, dynamic>> _logs = [];
  StreamSubscription<QuerySnapshot>? _logsSub;

  List<Map<String, dynamic>> get ulangLogs =>
      _logs.where((l) => l['type'] == 'ulang').toList();
  List<Map<String, dynamic>> get plantLogs =>
      _logs.where((l) => l['type'] == 'plant').toList();

  final sizeController = TextEditingController();
  final weightController = TextEditingController();
  DateTime selectedDate = DateTime.now();

  final plantHeightController = TextEditingController();
  final plantConditionController = TextEditingController();
  String? selectedPlantStage;
  String? selectedPlantName;
  DateTime plantDate = DateTime.now();

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
    _logsSub?.cancel();
    _fadeController.dispose();
    super.dispose();
  }

  void _initListener() {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    _logsSub = FirebaseFirestore.instance
        .collection('logs')
        .where('createdBy', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() {
        _logs = snap.docs.map((doc) {
          return {'id': doc.id, ...doc.data()};
        }).toList();
      });
    });
  }

  Future<void> _saveUlangLog() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    await FirebaseFirestore.instance.collection('logs').add({
      'title': sizeController.text,
      'description': weightController.text,
      'type': 'ulang',
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': uid,
    });
    sizeController.clear();
    weightController.clear();
  }

  Future<void> _savePlantLog() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    await FirebaseFirestore.instance.collection('logs').add({
      'title': selectedPlantName ?? '',
      'description':
          '${plantHeightController.text} | ${selectedPlantStage ?? ''} | ${plantConditionController.text}',
      'type': 'plant',
      'createdAt': FieldValue.serverTimestamp(),
      'createdBy': uid,
    });
    setState(() {
      selectedPlantName = null;
      selectedPlantStage = null;
    });
    plantHeightController.clear();
    plantConditionController.clear();
  }

  // =======================
  // Helpers
  // =======================

  double parseWeight(String weight) {
    return double.tryParse(weight.replaceAll(RegExp(r'[^\d.]'), '')) ?? 0;
  }

  List<Map<String, dynamic>> getWeightByLast7Days() {
    DateTime now = DateTime.now();
    List<Map<String, dynamic>> data = [];

    for (int i = 6; i >= 0; i--) {
      DateTime day = now.subtract(Duration(days: i));
      double total = 0;

      for (var log in ulangLogs) {
        final ts = log['createdAt'];
        DateTime d = ts is Timestamp ? ts.toDate() : DateTime.now();
        if (d.year == day.year && d.month == day.month && d.day == day.day) {
          total += parseWeight(log['description'] ?? '');
        }
      }

      data.add({
        'label': "${day.month}/${day.day}",
        'total': total,
      });
    }

    return data;
  }

  // =======================
  // UI
  // =======================

  @override
  Widget build(BuildContext context) {
    final weekData = getWeightByLast7Days();
    final maxWeight =
        weekData.map((e) => e['total'] as double).fold(0.0, max);

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
                "Ulang & Plant Records",
                style: GoogleFonts.poppins(
                  fontSize: 26,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF0F766E),
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                "Track physical information and growth of ulang and plants.",
                style: GoogleFonts.poppins(
                  fontSize: 14,
                  color: const Color(0xFF6B7280),
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 24),

              // =======================
              // Statistics
              // =======================
              Row(
                children: [
                  _statCard("Ulang Logs", ulangLogs.length.toString()),
                  const SizedBox(width: 12),
                  _statCard("Plant Logs", plantLogs.length.toString()),
                ],
              ),
              const SizedBox(height: 24),

              // =======================
              // Weekly Weight Chart
              // =======================
              Text(
                "Weekly Ulang Weight",
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF0F766E),
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: 12),
              GlassmorphicCard(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.6),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: Colors.white.withOpacity(0.5),
                    ),
                  ),
                  child: Column(
                    children: weekData.map((d) {
                      double pct = maxWeight > 0 ? d['total'] / maxWeight : 0;
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          children: [
                            SizedBox(
                              width: 50,
                              child: Text(
                                d['label'],
                                style: GoogleFonts.poppins(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF6B7280),
                                ),
                              ),
                            ),
                            Expanded(
                              child: Container(
                                height: 24,
                                decoration: BoxDecoration(
                                  color: teal.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: FractionallySizedBox(
                                  alignment: Alignment.centerLeft,
                                  widthFactor: pct,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        colors: [teal, tealDark],
                                        begin: Alignment.topLeft,
                                        end: Alignment.bottomRight,
                                      ),
                                      borderRadius: BorderRadius.circular(6),
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Text(
                              "${d['total'].toStringAsFixed(1)} g",
                              style: GoogleFonts.poppins(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: teal,
                              ),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),
              const SizedBox(height: 24),

              // =======================
              // Ulang Form
              // =======================
              Text(
                "Ulang Physical Information",
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF0F766E),
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: 12),
              GlassmorphicCard(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.6),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: Colors.white.withOpacity(0.5),
                    ),
                  ),
                  child: Column(
                    children: [
                      _buildInputField(sizeController, "Size (cm)"),
                      const SizedBox(height: 12),
                      _buildInputField(weightController, "Weight (g)"),
                      const SizedBox(height: 16),
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            if (sizeController.text.isNotEmpty &&
                                weightController.text.isNotEmpty) {
                              _saveUlangLog();
                            }
                          },
                          borderRadius: BorderRadius.circular(8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 18,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [teal, tealDark],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(8),
                              boxShadow: [
                                BoxShadow(
                                  color: teal.withOpacity(0.2),
                                  blurRadius: 8,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: Center(
                              child: Text(
                                "Save Ulang Log",
                                style: GoogleFonts.poppins(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              if (ulangLogs.isNotEmpty) ...[
                Text(
                  "Previous Ulang Logs",
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF0F766E),
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 12),
                ...ulangLogs.map((log) => GlassmorphicCard(
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.6),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.5),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: seaBlue.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(Icons.pets, color: seaBlue, size: 20),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    "Laki: ${log['title'] ?? ''}",
                                    style: GoogleFonts.poppins(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: const Color(0xFF0F766E),
                                    ),
                                  ),
                                  Text(
                                    "Bigat: ${log['description'] ?? ''}",
                                    style: GoogleFonts.poppins(
                                      fontSize: 12,
                                      color: const Color(0xFF6B7280),
                                      fontWeight: FontWeight.w400,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    )),
                const SizedBox(height: 24),
              ],

              // =======================
              // Plant Section
              // =======================
              Text(
                "Plant Physical Information",
                style: GoogleFonts.poppins(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF0F766E),
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: 12),
              GlassmorphicCard(
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.6),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: Colors.white.withOpacity(0.5),
                    ),
                  ),
                  child: Column(
                    children: [
                      _buildCustomDropdown(
                        value: selectedPlantName,
                        hint: "Select Plant Name",
                        label: "Plant Name",
                        icon: Icons.eco,
                        items: const [
                          DropdownMenuItem(
                            value: 'Mint',
                            child: Text('Mint'),
                          ),
                          DropdownMenuItem(
                            value: 'Oregano',
                            child: Text('Oregano'),
                          ),
                        ],
                        onChanged: (value) {
                          setState(() {
                            selectedPlantName = value;
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      _buildInputField(plantHeightController, "Height (cm)"),
                      const SizedBox(height: 12),
                      _buildInputField(plantConditionController, "Condition"),
                      const SizedBox(height: 12),
                      _buildCustomDropdown(
                        value: selectedPlantStage,
                        hint: "Select Growth Stage",
                        label: "Growth Stage",
                        icon: Icons.trending_up,
                        items: const [
                          DropdownMenuItem(
                            value: 'Seedling',
                            child: Text('Seedling'),
                          ),
                          DropdownMenuItem(
                            value: 'Vegetative',
                            child: Text('Vegetative'),
                          ),
                          DropdownMenuItem(
                            value: 'Pre-Flowering',
                            child: Text('Pre-Flowering'),
                          ),
                          DropdownMenuItem(
                            value: 'Harvest',
                            child: Text('Harvest'),
                          ),
                        ],
                        onChanged: (value) {
                          setState(() {
                            selectedPlantStage = value;
                          });
                        },
                      ),
                      const SizedBox(height: 16),
                      Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            if (selectedPlantName != null &&
                                plantHeightController.text.isNotEmpty &&
                                plantConditionController.text.isNotEmpty &&
                                selectedPlantStage != null) {
                              _savePlantLog();
                            }
                          },
                          borderRadius: BorderRadius.circular(8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 18,
                              vertical: 12,
                            ),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [teal, tealDark],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(8),
                              boxShadow: [
                                BoxShadow(
                                  color: teal.withOpacity(0.2),
                                  blurRadius: 8,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: Center(
                              child: Text(
                                "Save plant log",
                                style: GoogleFonts.poppins(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),

              if (plantLogs.isNotEmpty) ...[
                Text(
                  "Previous Plant Logs",
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF0F766E),
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(height: 12),
                ...plantLogs.map((log) => GlassmorphicCard(
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.6),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.5),
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: teal.withOpacity(0.15),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(Icons.eco, color: teal, size: 20),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    log['title'] ?? "Plant",
                                    style: GoogleFonts.poppins(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: const Color(0xFF0F766E),
                                    ),
                                  ),
                                  if ((log['description'] ?? '').isNotEmpty)
                                    Text(
                                      log['description'] ?? '',
                                      style: GoogleFonts.poppins(
                                        fontSize: 12,
                                        color: const Color(0xFF6B7280),
                                        fontWeight: FontWeight.w400,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    )),
              ],
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
                    page: const YieldEstimationPage(),
                  ),
                  _buildNavLink(
                    Icons.list,
                    "Logs",
                    context,
                    isActive: true,
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

  Widget _buildInputField(TextEditingController controller, String label) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: teal.withOpacity(0.08),
            blurRadius: 8,
            offset: const Offset(0, 1),
          ),
        ],
      ),
      child: TextField(
        controller: controller,
        style: GoogleFonts.poppins(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: const Color(0xFF111827),
        ),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: GoogleFonts.poppins(
            fontSize: 13,
            color: const Color(0xFF6B7280),
            fontWeight: FontWeight.w400,
          ),
          hintStyle: GoogleFonts.poppins(
            fontSize: 13,
            color: const Color(0xFF9CA3AF),
            fontWeight: FontWeight.w400,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
              width: 1.5,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
              width: 1.5,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: BorderSide(
              color: teal,
              width: 2,
            ),
          ),
          filled: true,
          fillColor: Colors.white.withOpacity(0.95),
          contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        ),
      ),
    );
  }

  Widget _buildCustomDropdown<T>({
    required T? value,
    required String hint,
    required String label,
    required IconData icon,
    required List<DropdownMenuItem<T>> items,
    required void Function(T?) onChanged,
  }) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: LinearGradient(
          colors: [
            Colors.white.withOpacity(0.95),
            Colors.white.withOpacity(0.85),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: teal.withOpacity(0.1),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: DropdownButtonFormField<T>(
        value: value,
        isExpanded: true,
        hint: Text(
          hint,
          style: GoogleFonts.poppins(
            fontSize: 14,
            color: const Color(0xFF9CA3AF),
            fontWeight: FontWeight.w400,
          ),
        ),
        style: GoogleFonts.poppins(
          fontSize: 14,
          fontWeight: FontWeight.w500,
          color: const Color(0xFF111827),
        ),
        decoration: InputDecoration(
          labelText: label,
          labelStyle: GoogleFonts.poppins(
            fontSize: 13,
            color: tealDark,
            fontWeight: FontWeight.w600,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: teal.withOpacity(0.3),
              width: 1.5,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: teal.withOpacity(0.2),
              width: 1.5,
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide(
              color: teal,
              width: 2,
            ),
          ),
          filled: true,
          fillColor: Colors.transparent,
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        ),
        icon: const SizedBox.shrink(),
        items: items,
        onChanged: onChanged,
        dropdownColor: Colors.white.withOpacity(0.98),
      ),
    );
  }

  Widget _statCard(String label, String value) {
    return Expanded(
      child: GlassmorphicCard(
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.6),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: Colors.white.withOpacity(0.5),
            ),
          ),
          child: Column(
            children: [
              Text(
                value,
                style: GoogleFonts.poppins(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: teal,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: const Color(0xFF6B7280),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GlassmorphicCard extends StatelessWidget {
  final Widget child;

  const GlassmorphicCard({Key? key, required this.child}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: child,
      ),
    );
  }
}

