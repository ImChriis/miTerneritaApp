import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
  Modal,
  Dimensions,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, CameraView } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const Home: React.FC<Props> = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState({
    idDetalle: "",
    noDocumento: "",
    nombre: "",
    fecha: "",
    hora: "",
    lugar: "",
    fila: "",
    cantidad: "",
    zona: "",
    fechaRevisado: "",
    horaRevisado: "",
    revisado: "",
  });

  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultModalType, setResultModalType] = useState<
    "aprobado" | "rechazado" | null
  >(null);
  const [resultModalMessage, setResultModalMessage] = useState("");
  const [invalidQRModalVisible, setInvalidQRModalVisible] = useState(false);

  const api: string = process.env.EXPO_PUBLIC_API_URL;

  // Función helper para incluir cabeceras de autorización
  const getAuthHeaders = async () => {
    const token = await SecureStore.getItemAsync("userToken");
    return {
      "Content-Type": "application/json",
      Authorization: token ? `Bearer ${token}` : "",
    };
  };

  function formatTime(time: string): string {
    if (!time) return "";
    const [hours, minutes] = time.split(":").map(Number);
    const ampm = hours >= 12 ? "PM" : "AM";
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes < 10 ? "0" + minutes : minutes;
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  }

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync("userToken");
    navigation.replace("Login");
  };

  const handleBarCodeScanned = async (result: { type: string; data: string } | undefined) => {
    console.log("QR escaneado:", result);

    if (!result || !result.type || !result.data) return;
    if (!scanned) {
      setScanned(true);
      let idDetalle: string | null = null;
      let noDocumento: string | null = null;
      let nombre = "";
      let fecha = "";
      let hora = "";
      let lugar = "";
      let fila = "";
      let cantidad = "";
      let zona = "";
      let revisado = "";

      const now = new Date();
      const fechaRevisado = `${String(now.getDate()).padStart(2, "0")}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}-${now.getFullYear()}`;
      let hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";
      hours = hours % 12 || 12;
      const horaRevisado = `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;

      const invoicesMatch = result.data.match(/invoices\/(\d+)$/);
      const invoiceMatch = result.data.match(/invoice\/(\d+)$/);
      if (invoicesMatch) idDetalle = invoicesMatch[1];
      else if (invoiceMatch) noDocumento = invoiceMatch[1];

      const headers = await getAuthHeaders();

      if (idDetalle) {
        try {
          const response = await fetch(`${api}/facturacion/detalles.php`, { headers });
          const responseDetails = await fetch(
            `${api}/facturacion/detalles.php?idDetalle=${idDetalle}`,
            { headers }
          );
          const details = await responseDetails.json();
          const payments = await response.json();
          const payment = payments.find((p: any) => p.idDetalle === idDetalle);

          if (details.status === "Aprobado" || details.status === "Rechazado") {
            cantidad = details.cantidadDeEntradas?.toString() || "";
            fila = details.fila?.toString() || "";
            zona = details.nombreZona ?? "";
            revisado = details.revisado?.toString() || "";

            let fRevisado = "";
            let hRevisado = "";
            if (revisado) {
              const partes = revisado.split(" ");
              fRevisado = partes[0] || "";
              hRevisado = partes[1] && partes[2] ? `${partes[1]} ${partes[2]}` : "";
            }

            setModalData({
              idDetalle: idDetalle ?? "No encontrado",
              noDocumento: noDocumento ?? "No encontrado",
              nombre,
              fecha: formatDate(fecha),
              hora: formatTime(hora),
              lugar,
              fila,
              cantidad,
              zona,
              fechaRevisado: fRevisado,
              horaRevisado: hRevisado,
              revisado,
            });
            setResultModalType(details.status === "Aprobado" ? "aprobado" : "rechazado");
            setResultModalMessage(
              details.status === "Aprobado"
                ? "Esta entrada ya fue aprobada."
                : "Esta entrada ya fue rechazada."
            );
            setResultModalVisible(true);
            setScanned(false);
            return;
          }

          if (payment && details) {
            noDocumento = payment.noDocumento;
            fila = payment.fila?.toString() || "";
            cantidad = details.cantidadDeEntradas?.toString() || "";
            zona = details.nombreZona;
            setModalData((prev) => ({ ...prev, fila, cantidad, zona }));
          }
        } catch (error) {
          console.error("Error al obtener detalles:", error);
        }
      }

      if (noDocumento) {
        try {
          const response = await fetch(
            `${api}/facturacion/facturacion.php?noDocumento=${noDocumento}`,
            { headers }
          );
          const payment = await response.json();

          if (Array.isArray(payment) && payment[0]?.idEvento) {
            const eventResponse = await fetch(
              `${api}/eventos/eventos.php?idEvento=${payment[0].idEvento}`,
              { headers }
            );
            const event = await eventResponse.json();
            nombre = event.nombre || "";
            fecha = event.fecha || "";
            hora = event.hora || "";
            lugar = event.lugar || "";
          } else if (payment.idEvento) {
            const eventResponse = await fetch(
              `${api}/eventos/eventos.php?idEvento=${payment.idEvento}`,
              { headers }
            );
            const event = await eventResponse.json();
            nombre = event.nombre || "";
            fecha = event.fecha || "";
            hora = event.hora || "";
            lugar = event.lugar || "";
          }
        } catch (error) {
          console.error("Error al obtener datos del pago/evento:", error);
        }
      }

      if (
        (!idDetalle || idDetalle === "No encontrado") &&
        (!noDocumento || noDocumento === "No encontrado") &&
        !nombre &&
        !fecha &&
        !hora &&
        !lugar &&
        !fila &&
        !cantidad
      ) {
        setInvalidQRModalVisible(true);
        setScanned(false);
        return;
      }

      setModalData({
        idDetalle: idDetalle ?? "No encontrado",
        noDocumento: noDocumento ?? "No encontrado",
        nombre,
        fecha: formatDate(fecha),
        hora: formatTime(hora),
        lugar,
        fila,
        cantidad,
        zona,
        fechaRevisado,
        horaRevisado,
        revisado,
      });
      setModalVisible(true);
    }
  };

  const handleStatusUpdate = async (status: string) => {
    const revisado = `${modalData.fechaRevisado} ${modalData.horaRevisado}`;
    const url = `${api}/facturacion/detalles.php`;

    let body: any = { accion: "actualizarStatus", status, revisado };

    if (modalData.idDetalle && modalData.idDetalle !== "No encontrado") {
      body.idDetalle = Number(modalData.idDetalle);
    } else if (modalData.noDocumento && modalData.noDocumento !== "No encontrado") {
      body.noDocumento = Number(modalData.noDocumento);
    } else {
      Alert.alert("Error", "No se encontró idDetalle ni noDocumento.");
      return;
    }

    const headers = await getAuthHeaders();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const text = await response.text();
      let data = text ? JSON.parse(text) : {};

      if (response.ok) {
        setResultModalType(status === "Rechazado" ? "rechazado" : "aprobado");
        setResultModalMessage(
          status === "Rechazado"
            ? "La entrada ha sido rechazada correctamente."
            : "La entrada ha sido aprobada correctamente."
        );
        setResultModalVisible(true);
      } else {
        Alert.alert("Error", "Error al actualizar el estado.");
      }
    } catch (error) {
      console.error("Error al actualizar status:", error);
      Alert.alert("Error", "Error al conectar con la API.");
    }
  };

  if (hasPermission === null) return <Text style={styles.centerText}>Solicitando permiso para usar la cámara...</Text>;
  if (hasPermission === false) return <Text style={styles.centerText}>No se tiene permiso para usar la cámara.</Text>;

  const { width, height } = Dimensions.get("window");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#22242e" }}>
      <View style={styles.headerRow}>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Cerrar Sesión</Text>
        </Pressable>
      </View>

      {/* MODAL QR INVÁLIDO */}
      <Modal visible={invalidQRModalVisible} transparent animationType="fade" onRequestClose={() => setInvalidQRModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, styles.resultModalRechazado]}>
            <Text style={styles.resultModalIcon}>❌</Text>
            <Text style={styles.resultModalText}>QR inválido</Text>
            <Pressable style={styles.resultModalButton} onPress={() => setInvalidQRModalVisible(false)}>
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL RESULTADO */}
      <Modal visible={resultModalVisible} transparent animationType="fade" onRequestClose={() => setResultModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, resultModalType === "aprobado" ? styles.resultModalAprobado : styles.resultModalRechazado]}>
            <Text style={styles.resultModalIcon}>{resultModalType === "aprobado" ? "✅" : "❌"}</Text>
            <Text style={styles.resultModalText}>{resultModalMessage}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Entrada:</Text> {modalData.fila} de {modalData.cantidad}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Fecha revisión:</Text> {modalData.fechaRevisado}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Hora revisión:</Text> {modalData.horaRevisado}</Text>
            <Pressable style={styles.resultModalButton} onPress={() => setResultModalVisible(false)}>
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL DETALLES QR */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: width * 0.9 }]}>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Nombre:</Text> {modalData.nombre}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Fecha:</Text> {modalData.fecha}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Hora:</Text> {modalData.hora}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Lugar:</Text> {modalData.lugar}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Zona:</Text> {modalData.zona}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Entrada:</Text> {modalData.fila} de {modalData.cantidad}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Fecha revisión:</Text> {modalData.fechaRevisado}</Text>
            <Text style={styles.modalInfo}><Text style={styles.bold}>Hora revisión:</Text> {modalData.horaRevisado}</Text>
            <View style={styles.buttonRow}>
              <Pressable style={[styles.actionButton, styles.approveButton]} onPress={async () => { setModalVisible(false); await handleStatusUpdate("Aprobado"); }}>
                <Text style={styles.buttonActionText}>Aprobar</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.rejectButton]} onPress={async () => { setModalVisible(false); await handleStatusUpdate("Rechazado"); }}>
                <Text style={styles.buttonActionText}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.container}>
          <Text style={styles.title}>Escanea un Código QR</Text>
          <CameraView
            style={{ width: width * 0.9, height: height * 0.5, borderRadius: 16 }}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            ref={cameraRef}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          />
          {scanned && (
            <Pressable style={styles.button} onPress={() => setScanned(false)}>
              <Text style={styles.buttonText}>Escanear de nuevo</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#22242e" },
  centerText: { flex: 1, color: "white", textAlign: "center", marginTop: 40 },
  headerRow: { width: "100%", alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 10 },
  logoutButton: { backgroundColor: "#F44336", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  logoutButtonText: { color: "white", fontWeight: "bold", fontSize: 12 },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 20, color: "white" },
  button: { width: "90%", backgroundColor: "transparent", padding: 10, borderRadius: 5, alignItems: "center", marginTop: 10, borderWidth: 1, borderColor: "white" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalContent: { backgroundColor: "white", borderRadius: 10, padding: 24, width: "85%", alignItems: "center" },
  modalInfo: { fontSize: 16, marginBottom: 8, textAlign: "left", width: "100%" },
  bold: { fontWeight: "bold" },
  buttonRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 24 },
  actionButton: { flex: 1, padding: 12, borderRadius: 6, alignItems: "center", marginHorizontal: 8 },
  approveButton: { backgroundColor: "#4CAF50" },
  rejectButton: { backgroundColor: "#F44336" },
  buttonActionText: { color: "white", fontWeight: "bold", fontSize: 16 },
  resultModalContent: { backgroundColor: "white", borderRadius: 12, padding: 32, alignItems: "center", width: 280 },
  resultModalAprobado: { borderColor: "#4CAF50", borderWidth: 3 },
  resultModalRechazado: { borderColor: "#F44336", borderWidth: 3 },
  resultModalIcon: { fontSize: 48, marginBottom: 16 },
  resultModalText: { fontSize: 18, fontWeight: "bold", marginBottom: 24, textAlign: "center" },
  resultModalButton: { backgroundColor: "#22242e", paddingVertical: 10, paddingHorizontal: 24, borderRadius: 6 },
  resultModalButtonText: { color: "white", fontWeight: "bold", fontSize: 16 },
});

export default Home;