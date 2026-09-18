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
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, CameraView } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

interface TicketDetail {
  idTicket: number;
  tipo: string;
  cantidad: number;
}

interface PaymentValidationData {
  idPayment: number;
  buyerName: string;
  buyerEmail: string;
  eventName: string;
  eventDate: string;
  ticketCount: number;
  entradas: TicketDetail[];
}

const Home: React.FC<Props> = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState<PaymentValidationData | null>(null);

  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultModalType, setResultModalType] = useState<"aprobado" | "rechazado" | "advertencia" | null>(null);
  const [resultModalMessage, setResultModalMessage] = useState("");
  const [invalidQRModalVisible, setInvalidQRModalVisible] = useState(false);

  const api: string = process.env.EXPO_PUBLIC_API_URL || "";

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
    if (!result || !result.data || scanned || loading) return;

    // Bloquea nuevos escaneos inmediatamente
    setScanned(true);
    setLoading(true);

    try {
      console.log("QR escaneado:", result.data);

      const token = await SecureStore.getItemAsync("userToken");

      const response = await fetch(`${api}/code/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ token: result.data }),
      });

      console.log("Respuesta status:", response.status);

      // Control del error 409
      if (response.status === 409) {
        const errorData = await response.json();
        setResultModalType("advertencia");
        setResultModalMessage(errorData.message || "El código QR ya fue procesado o presenta un conflicto.");
        setResultModalVisible(true);
        return;
      }

      if (!response.ok) {
        setInvalidQRModalVisible(true);
        return;
      }

      const responseData: PaymentValidationData = await response.json();

      if (!responseData || !responseData.idPayment) {
        setInvalidQRModalVisible(true);
        return;
      }

      setModalData(responseData);
      setModalVisible(true);
    } catch (error) {
      console.error("Error validando QR:", error);
      setInvalidQRModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (status: "Aprobado" | "Rechazado") => {
    if (!modalData) return;

    const token = await SecureStore.getItemAsync("userToken");

    try {
      const response = await fetch(`${api}/facturacion/detalles.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          accion: "actualizarStatus",
          idPayment: modalData.idPayment,
          status,
        }),
      });

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
        setScanned(false);
      }
    } catch (error) {
      console.error("Error al actualizar status:", error);
      Alert.alert("Error", "Error al conectar con la API.");
      setScanned(false);
    }
  };

  if (hasPermission === null)
    return <Text style={styles.centerText}>Solicitando permiso para usar la cámara...</Text>;
  if (hasPermission === false)
    return <Text style={styles.centerText}>No se tiene permiso para usar la cámara.</Text>;

  const { width, height } = Dimensions.get("window");

  // Determinar ícono según el tipo de resultado
  const getResultIcon = () => {
    if (resultModalType === "aprobado") return "✅";
    if (resultModalType === "advertencia") return "⚠️";
    return "❌";
  };

  // Determinar estilo de borde según el resultado
  const getResultBorderStyle = () => {
    if (resultModalType === "aprobado") return styles.resultModalAprobado;
    if (resultModalType === "advertencia") return styles.resultModalAdvertencia;
    return styles.resultModalRechazado;
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#22242e" }}>
      <View style={styles.headerRow}>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Cerrar Sesión</Text>
        </Pressable>
      </View>

      {/* MODAL QR INVÁLIDO */}
      <Modal
        visible={invalidQRModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setInvalidQRModalVisible(false);
          setScanned(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, styles.resultModalRechazado]}>
            <Text style={styles.resultModalIcon}>❌</Text>
            <Text style={styles.resultModalText}>QR inválido o no encontrado</Text>
            <Pressable
              style={styles.resultModalButton}
              onPress={() => {
                setInvalidQRModalVisible(false);
                setScanned(false); // Reactiva el escáner al pulsar el botón
              }}
            >
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL RESULTADO (Aprobado / Rechazado / 409 Advertencia) */}
      <Modal
        visible={resultModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setResultModalVisible(false);
          setModalData(null);
          setScanned(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, getResultBorderStyle()]}>
            <Text style={styles.resultModalIcon}>{getResultIcon()}</Text>
            <Text style={styles.resultModalText}>{resultModalMessage}</Text>
            {modalData && (
              <Text style={styles.modalInfo}>
                <Text style={styles.bold}>Comprador:</Text> {modalData.buyerName}
              </Text>
            )}
            <Pressable
              style={styles.resultModalButton}
              onPress={() => {
                setResultModalVisible(false);
                setModalData(null);
                setScanned(false); // Reactiva el escáner al pulsar el botón
              }}
            >
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL DETALLES QR */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setModalVisible(false);
          setScanned(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: width * 0.9 }]}>
            <ScrollView style={{ width: "100%" }}>
              <Text style={styles.modalTitle}>Detalles de la Compra</Text>

              {modalData && (
                <>
                  <Text style={styles.modalInfo}>
                    <Text style={styles.bold}>Comprador:</Text> {modalData.buyerName}
                  </Text>
                  <Text style={styles.modalInfo}>
                    <Text style={styles.bold}>Email:</Text> {modalData.buyerEmail}
                  </Text>
                  <Text style={styles.modalInfo}>
                    <Text style={styles.bold}>Evento:</Text> {modalData.eventName}
                  </Text>
                  <Text style={styles.modalInfo}>
                    <Text style={styles.bold}>Fecha del Evento:</Text>{" "}
                    {formatDate(modalData.eventDate)}
                  </Text>
                  <Text style={styles.modalInfo}>
                    <Text style={styles.bold}>Total de Entradas:</Text> {modalData.ticketCount}
                  </Text>

                  <View style={styles.divider} />

                  <Text style={styles.subtitle}>Desglose por Tipo:</Text>
                  {modalData.entradas?.map((ticket) => (
                    <View key={ticket.idTicket} style={styles.ticketRow}>
                      <Text style={styles.ticketType}>• {ticket.tipo}</Text>
                      <Text style={styles.ticketCount}>
                        {ticket.cantidad} {ticket.cantidad === 1 ? "entrada" : "entradas"}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.actionButton, styles.approveButton]}
                onPress={async () => {
                  setModalVisible(false);
                  await handleStatusUpdate("Aprobado");
                }}
              >
                <Text style={styles.buttonActionText}>Aprobar</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.rejectButton]}
                onPress={async () => {
                  setModalVisible(false);
                  await handleStatusUpdate("Rechazado");
                }}
              >
                <Text style={styles.buttonActionText}>Rechazar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.container}>
          <Text style={styles.title}>Escanea un Código QR</Text>
          {loading ? (
            <ActivityIndicator size="large" color="#ffffff" style={{ height: height * 0.5 }} />
          ) : (
            <CameraView
              style={{ width: width * 0.9, height: height * 0.5, borderRadius: 16 }}
              facing="back"
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              ref={cameraRef}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            />
          )}
          {scanned && !loading && !modalVisible && !resultModalVisible && !invalidQRModalVisible && (
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
  modalContent: { backgroundColor: "white", borderRadius: 10, padding: 24, width: "85%", maxHeight: "80%", alignItems: "center" },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 16, textAlign: "center", color: "#22242e" },
  modalInfo: { fontSize: 15, marginBottom: 8, textAlign: "left", width: "100%", color: "#333" },
  subtitle: { fontSize: 16, fontWeight: "bold", marginTop: 8, marginBottom: 8, color: "#22242e" },
  bold: { fontWeight: "bold", color: "#111" },
  divider: { height: 1, backgroundColor: "#E0E0E0", width: "100%", marginVertical: 12 },
  ticketRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#F5F5F5", borderRadius: 4, marginBottom: 6 },
  ticketType: { fontSize: 14, fontWeight: "600", color: "#444" },
  ticketCount: { fontSize: 14, color: "#666" },
  buttonRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 20 },
  actionButton: { flex: 1, padding: 12, borderRadius: 6, alignItems: "center", marginHorizontal: 6 },
  approveButton: { backgroundColor: "#4CAF50" },
  rejectButton: { backgroundColor: "#F44336" },
  buttonActionText: { color: "white", fontWeight: "bold", fontSize: 16 },
  resultModalContent: { backgroundColor: "white", borderRadius: 12, padding: 24, alignItems: "center", width: 280 },
  resultModalAprobado: { borderColor: "#4CAF50", borderWidth: 3 },
  resultModalRechazado: { borderColor: "#F44336", borderWidth: 3 },
  resultModalAdvertencia: { borderColor: "#FFC107", borderWidth: 3 },
  resultModalIcon: { fontSize: 48, marginBottom: 12 },
  resultModalText: { fontSize: 16, fontWeight: "bold", marginBottom: 16, textAlign: "center", color: "#22242e" },
  resultModalButton: { backgroundColor: "#22242e", paddingVertical: 10, paddingHorizontal: 24, borderRadius: 6, marginTop: 12 },
  resultModalButtonText: { color: "white", fontWeight: "bold", fontSize: 14 },
});

export default Home;