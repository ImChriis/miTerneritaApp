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
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, CameraView, BarcodeScanningResult } from "expo-camera";
import * as SecureStore from "expo-secure-store";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../../App";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

interface EventItem {
  idEvents: number;
  name: string;
}

interface TicketDetail {
  idTicket: number;
  tipo: string;
  cantidad: number;
  usadas?: number;
  restantes?: number;
}

interface ScanHistory {
  idScan: number;
  scanId: string;
  fecha: string;
  total: number;
  usuario: {
    id: number;
    nombre: string;
  };
  entradas: Array<{
    idTicket: number;
    tipo: string;
    cantidad: number;
  }>;
}

interface PaymentValidationData {
  idPayment: number;
  noDocumento?: string;
  buyerName: string;
  buyerEmail: string;
  eventName: string;
  eventDate: string;
  ticketCount: number;
  usadas?: number;
  restantes?: number;
  agotada?: boolean;
  entradas: TicketDetail[];
  historial?: ScanHistory[];
}

const Home: React.FC<Props> = ({ navigation }) => {
  const [userName, setUserName] = useState<string>("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(true);
  const [dropdownVisible, setDropdownVisible] = useState<boolean>(false);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  const isProcessingRef = useRef(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalData, setModalData] = useState<PaymentValidationData | null>(null);

  const [selectedQuantities, setSelectedQuantities] = useState<{ [id: number]: number }>({});
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState<"Aprobado" | "Rechazado" | null>(null);

  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultModalType, setResultModalType] = useState<"aprobado" | "rechazado" | "advertencia" | null>(null);
  const [resultModalMessage, setResultModalMessage] = useState("");
  const [invalidQRModalVisible, setInvalidQRModalVisible] = useState(false);

  const [QrToken, setQrToken] = useState<string | null>(null);

  const api: string = process.env.EXPO_PUBLIC_API_URL || "";

  function formatDate(dateStr: string): string {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatTime(dateStr: string): string {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");

      const user = await SecureStore.getItemAsync("user");
      if (user) {
        const parsedUser = JSON.parse(user);
        setUserName(parsedUser.name + " " + parsedUser.lastName || "Usuario");
      }

      try {
        const token = await SecureStore.getItemAsync("userToken");

        const response = await fetch(`${api}/events`, {
          method: "GET",
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
          },
        });

        if (response.ok) {
          const eventsData = await response.json();
          setEvents(eventsData);
        } else {
          Alert.alert("Error", "No se pudieron obtener los eventos disponibles.");
        }
      } catch (error) {
        console.error("Error al cargar eventos:", error);
      } finally {
        setLoadingEvents(false);
      }
    })();
  }, []);

  const resetScanner = () => {
    isProcessingRef.current = false;
    setScanned(false);
  };

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync("userToken");
    await SecureStore.deleteItemAsync("userName");
    navigation.replace("Login");
  };

  const handleBarCodeScanned = async (result: BarcodeScanningResult) => {
    if (isProcessingRef.current || scanned || loading || !selectedEventId) return;

    isProcessingRef.current = true;
    setScanned(true);
    setLoading(true);

    try {
      const token = await SecureStore.getItemAsync("userToken");
      setQrToken(result.data);

      const response = await fetch(`${api}/code/lookup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          token: result.data,
          idEvents: selectedEventId,
        }),
      });

      if (response.status === 409) {
        const errorData = await response.json();
        setResultModalType("advertencia");
        setResultModalMessage(errorData.message || "El código QR ya fue procesado o presenta un conflicto.");
        setResultModalVisible(true);
        return;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Error del backend:", errorText);
        setInvalidQRModalVisible(true);
        return;
      }

      const responseData: PaymentValidationData = await response.json();

      if (!responseData || !responseData.idPayment) {
        setInvalidQRModalVisible(true);
        return;
      }

      setModalData(responseData);

      const initialQuantities: { [id: number]: number } = {};
      responseData.entradas?.forEach((t) => {
        const disponibles = t.restantes !== undefined ? t.restantes : (t.cantidad - (t.usadas || 0));
        initialQuantities[t.idTicket] = disponibles > 0 ? disponibles : 0;
      });
      setSelectedQuantities(initialQuantities);

      setModalVisible(true);
    } catch (error) {
      console.error("Error validando QR:", error);
      setInvalidQRModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleQuantityChange = (idTicket: number, delta: number, maxAmount: number) => {
    setSelectedQuantities((prev) => {
      const current = prev[idTicket] ?? 0;
      const next = current + delta;
      if (next < 0 || next > maxAmount) return prev;
      return { ...prev, [idTicket]: next };
    });
  };

  const getTotalSelectedCount = () => {
    return Object.values(selectedQuantities).reduce((acc, qty) => acc + qty, 0);
  };

  const handleOpenConfirmation = (action: "Aprobado" | "Rechazado") => {
    const totalSelected = getTotalSelectedCount();
    if (totalSelected === 0) {
      Alert.alert("Atención", "Debes seleccionar al menos una entrada para procesar.");
      return;
    }
    setPendingAction(action);
    setConfirmModalVisible(true);
  };

  const handleStatusUpdate = async () => {
    if (!modalData || !pendingAction) return;

    setConfirmModalVisible(false);
    setModalVisible(false);

    const token = await SecureStore.getItemAsync("userToken");

    const entradasAProcesar = modalData.entradas
      .map((item) => ({
        idTicket: item.idTicket,
        cantidad: selectedQuantities[item.idTicket] || 0,
      }))
      .filter((item) => item.cantidad > 0);

    try {
      const response = await fetch(`${api}/code/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({
          token: QrToken,
          idEvents: selectedEventId,
          entradas: entradasAProcesar,
        }),
      });

      if (response.ok) {
        const totalProcesadas = getTotalSelectedCount();
        setResultModalType(pendingAction === "Rechazado" ? "rechazado" : "aprobado");
        setResultModalMessage(
          pendingAction === "Rechazado"
            ? `Se han rechazado ${totalProcesadas} entrada(s) correctamente.`
            : `Se han aprobado ${totalProcesadas} entrada(s) correctamente.`
        );
        setResultModalVisible(true);
      } else {
        Alert.alert("Error", "Error al actualizar el estado.");
        resetScanner();
      }
    } catch (error) {
      console.error("Error al actualizar status:", error);
      Alert.alert("Error", "Error al conectar con la API.");
      resetScanner();
    } finally {
      setPendingAction(null);
    }
  };

  if (hasPermission === null)
    return <Text style={styles.centerText}>Solicitando permiso para usar la cámara...</Text>;
  if (hasPermission === false)
    return <Text style={styles.centerText}>No se tiene permiso para usar la cámara.</Text>;

  const { width, height } = Dimensions.get("window");

  const selectedEventName =
    events.find((e) => e.idEvents === selectedEventId)?.name || "Seleccionar evento...";

  const renderResultIcon = () => {
    if (resultModalType === "aprobado") {
      return <Ionicons name="checkmark-circle-outline" size={54} color="#4CAF50" style={styles.resultModalIcon} />;
    }
    if (resultModalType === "advertencia") {
      return <Ionicons name="warning-outline" size={54} color="#FFC107" style={styles.resultModalIcon} />;
    }
    return <Ionicons name="close-circle-outline" size={54} color="#F44336" style={styles.resultModalIcon} />;
  };

  const getResultBorderStyle = () => {
    if (resultModalType === "aprobado") return styles.resultModalAprobado;
    if (resultModalType === "advertencia") return styles.resultModalAdvertencia;
    return styles.resultModalRechazado;
  };

  // EVALUACIÓN SI TODAS LAS ENTRADAS YA SE USARON
  const isFullyScanned =
    modalData?.agotada ||
    (modalData?.restantes !== undefined && modalData.restantes === 0) ||
    (modalData?.entradas &&
      modalData.entradas.length > 0 &&
      modalData.entradas.every((t) => (t.restantes !== undefined ? t.restantes === 0 : t.usadas === t.cantidad)));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#22242e" }}>
      {/* HEADER */}
      <View style={styles.headerContainer}>
        <View>
          <Text style={styles.welcomeSubtitle}>Hola,</Text>
          <Text style={styles.welcomeTitle}>{userName}</Text>
        </View>
        <Pressable style={styles.logoutButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={14} color="white" style={{ marginRight: 4 }} />
          <Text style={styles.logoutButtonText}>Cerrar Sesión</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
        <View style={styles.container}>
          <Text style={styles.sectionTitle}>Selecciona el Evento a Escanear:</Text>

          {loadingEvents ? (
            <ActivityIndicator size="small" color="#ffffff" style={{ marginBottom: 15 }} />
          ) : (
            <View style={styles.dropdownContainer}>
              <Pressable
                style={styles.dropdownSelector}
                onPress={() => setDropdownVisible(true)}
              >
                <Text
                  style={[
                    styles.dropdownSelectorText,
                    !selectedEventId && styles.dropdownPlaceholderText,
                  ]}
                  numberOfLines={1}
                >
                  {selectedEventName}
                </Text>
                <Ionicons name="chevron-down" size={18} color="#AAA" />
              </Pressable>

              <Modal
                visible={dropdownVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setDropdownVisible(false)}
              >
                <Pressable
                  style={styles.modalOverlay}
                  onPress={() => setDropdownVisible(false)}
                >
                  <View style={styles.dropdownModalContent}>
                    <Text style={styles.dropdownModalTitle}>Lista de Eventos</Text>
                    <FlatList
                      data={events}
                      keyExtractor={(item, index) =>
                        item.idEvents ? `event-${item.idEvents}` : `event-idx-${index}`
                      }
                      renderItem={({ item }) => {
                        const isSelected = selectedEventId === item.idEvents;
                        return (
                          <Pressable
                            style={[
                              styles.dropdownOption,
                              isSelected && styles.dropdownOptionSelected,
                            ]}
                            onPress={() => {
                              setSelectedEventId(item.idEvents);
                              setDropdownVisible(false);
                              resetScanner();
                            }}
                          >
                            <Text
                              style={[
                                styles.dropdownOptionText,
                                isSelected && styles.dropdownOptionTextSelected,
                              ]}
                            >
                              {item.name}
                            </Text>
                            {isSelected && <Ionicons name="checkmark" size={18} color="white" />}
                          </Pressable>
                        );
                      }}
                    />
                  </View>
                </Pressable>
              </Modal>
            </View>
          )}

          {!selectedEventId ? (
            <View style={[styles.placeholderBox, { width: width * 0.9, height: height * 0.45 }]}>
              <Ionicons name="alert-circle-outline" size={36} color="#888" style={{ marginBottom: 8 }} />
              <Text style={styles.placeholderText}>
                Por favor selecciona un evento arriba para activar la cámara
              </Text>
            </View>
          ) : loading ? (
            <ActivityIndicator size="large" color="#ffffff" style={{ height: height * 0.45 }} />
          ) : (
            <CameraView
              style={{ width: width * 0.9, height: height * 0.45, borderRadius: 16 }}
              facing="back"
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
              ref={cameraRef}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            />
          )}

          {scanned && !loading && !modalVisible && !resultModalVisible && !invalidQRModalVisible && (
            <Pressable style={styles.button} onPress={resetScanner}>
              <Ionicons name="qr-code-outline" size={18} color="white" style={{ marginRight: 6 }} />
              <Text style={styles.buttonText}>Escanear de nuevo</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* MODAL QR INVÁLIDO */}
      <Modal
        visible={invalidQRModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setInvalidQRModalVisible(false);
          resetScanner();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, styles.resultModalRechazado]}>
            <Ionicons name="close-circle-outline" size={54} color="#F44336" style={styles.resultModalIcon} />
            <Text style={styles.resultModalText}>QR inválido o no encontrado</Text>
            <Pressable
              style={styles.resultModalButton}
              onPress={() => {
                setInvalidQRModalVisible(false);
                resetScanner();
              }}
            >
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL RESULTADO */}
      <Modal
        visible={resultModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setResultModalVisible(false);
          setModalData(null);
          resetScanner();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.resultModalContent, getResultBorderStyle()]}>
            {renderResultIcon()}
            <Text style={styles.resultModalText}>{resultModalMessage}</Text>
            {modalData && (
              <Text style={styles.modalInfoText}>
                <Text style={styles.bold}>Comprador:</Text> {modalData.buyerName}
              </Text>
            )}
            <Pressable
              style={styles.resultModalButton}
              onPress={() => {
                setResultModalVisible(false);
                setModalData(null);
                resetScanner();
              }}
            >
              <Text style={styles.resultModalButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* MODAL CONFIRMACIÓN PREVIA */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContent}>
            <Ionicons name="help-circle-outline" size={44} color="#22242e" style={{ marginBottom: 6 }} />
            <Text style={styles.confirmTitle}>¿Confirmar Acción?</Text>
            <Text style={styles.confirmMessage}>
              ¿Estás seguro que deseas{" "}
              <Text style={{ fontWeight: "bold", color: pendingAction === "Aprobado" ? "#4CAF50" : "#F44336" }}>
                {pendingAction === "Aprobado" ? "APROBAR" : "RECHAZAR"}
              </Text>{" "}
              un total de <Text style={styles.bold}>{getTotalSelectedCount()}</Text> entrada(s)?
            </Text>

            <View style={styles.buttonRow}>
              <Pressable
                style={[styles.actionButton, styles.confirmCancelButton]}
                onPress={() => setConfirmModalVisible(false)}
              >
                <Text style={styles.buttonActionText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.actionButton,
                  pendingAction === "Aprobado" ? styles.approveButton : styles.rejectButton,
                ]}
                onPress={handleStatusUpdate}
              >
                <Text style={styles.buttonActionText}>Confirmar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL DETALLES QR / AGOTADO */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setModalVisible(false);
          resetScanner();
        }}
      >
        <View style={styles.modalOverlay}>
          {isFullyScanned ? (
            /* ESTILO TIPO ADVERTENCIA CON VECTOR ICON EN LUGAR DE EMOJI */
            <View style={[styles.resultModalContent, styles.resultModalAdvertencia]}>
              <Ionicons name="warning-outline" size={54} color="#FFC107" style={styles.resultModalIcon} />
              <Text style={styles.resultModalText}>Todas las entradas ya fueron utilizadas</Text>

              {modalData && (
                <ScrollView style={{ width: "100%", maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                  <Text style={styles.modalInfoText}>
                    <Text style={styles.bold}>Comprador:</Text> {modalData.buyerName}
                  </Text>
                  <Text style={styles.modalInfoText}>
                    <Text style={styles.bold}>Evento:</Text> {modalData.eventName}
                  </Text>

                  <View style={styles.divider} />

                  <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 6 }}>
                    <MaterialCommunityIcons name="history" size={16} color="#22242e" style={{ marginRight: 4 }} />
                    <Text style={styles.sectionSubtitleText}>Historial de Ingresos:</Text>
                  </View>

                  {modalData.historial && modalData.historial.length > 0 ? (
                    modalData.historial.map((item, idx) => (
                      <View key={item.idScan || idx} style={styles.historyCard}>
                        <View style={styles.historyCardHeader}>
                          <View style={{ flexDirection: "row", alignItems: "center" }}>
                            <Ionicons name="person-outline" size={12} color="#2D3748" style={{ marginRight: 3 }} />
                            <Text style={styles.historyUserText}>
                              {item.usuario?.nombre || "Sistema"}
                            </Text>
                          </View>
                          <Text style={styles.historyTimeText}>{formatTime(item.fecha)} hs</Text>
                        </View>
                        <Text style={styles.historyTotalText}>
                          Ingresadas: <Text style={{ fontWeight: "bold" }}>{item.total}</Text>
                        </Text>
                        {item.entradas?.map((ent, entIdx) => (
                          <Text key={entIdx} style={styles.historyDetailText}>
                            • {ent.tipo}: {ent.cantidad} ud.
                          </Text>
                        ))}
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyHistoryText}>
                      No hay detalles adicionales en el historial.
                    </Text>
                  )}
                </ScrollView>
              )}

              <Pressable
                style={styles.resultModalButton}
                onPress={() => {
                  setModalVisible(false);
                  resetScanner();
                }}
              >
                <Text style={styles.resultModalButtonText}>Cerrar</Text>
              </Pressable>
            </View>
          ) : (
            /* MODAL ESTÁNDAR PARA PROCESAR ENTRADAS DISPONIBLES */
            <View style={[styles.modalContent, { maxWidth: width * 0.92 }]}>
              <ScrollView style={{ width: "100%" }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>Detalles de la Compra</Text>

                {modalData && (
                  <>
                    <Text style={styles.modalInfoText}>
                      <Text style={styles.bold}>Comprador:</Text> {modalData.buyerName}
                    </Text>
                    <Text style={styles.modalInfoText}>
                      <Text style={styles.bold}>Email:</Text> {modalData.buyerEmail}
                    </Text>
                    <Text style={styles.modalInfoText}>
                      <Text style={styles.bold}>Evento:</Text> {modalData.eventName}
                    </Text>
                    <Text style={styles.modalInfoText}>
                      <Text style={styles.bold}>Fecha del evento:</Text> {formatDate(modalData.eventDate)}
                    </Text>

                    <View style={styles.divider} />

                    <Text style={styles.subtitle}>Selección de Entradas a Procesar:</Text>

                    {modalData.entradas?.map((ticket) => {
                      const maxAvailable =
                        ticket.restantes !== undefined
                          ? ticket.restantes
                          : ticket.cantidad - (ticket.usadas || 0);

                      const currentQty = selectedQuantities[ticket.idTicket] ?? 0;
                      const isExhausted = maxAvailable <= 0;

                      return (
                        <View
                          key={ticket.idTicket}
                          style={[styles.ticketCard, isExhausted && styles.ticketCardDisabled]}
                        >
                          <View style={styles.ticketInfoCol}>
                            <Text style={styles.ticketType}>{ticket.tipo}</Text>
                            <Text style={styles.ticketSubtitle}>
                              Disponibles: <Text style={styles.boldText}>{maxAvailable}</Text> de {ticket.cantidad}
                            </Text>
                            {ticket.usadas !== undefined && ticket.usadas > 0 && (
                              <Text style={styles.ticketUsedText}>
                                (Ya ingresaron: {ticket.usadas})
                              </Text>
                            )}
                          </View>

                          <View style={styles.counterRow}>
                            <Pressable
                              style={[styles.counterBtn, (currentQty === 0 || isExhausted) && styles.counterBtnDisabled]}
                              onPress={() => handleQuantityChange(ticket.idTicket, -1, maxAvailable)}
                              disabled={currentQty === 0 || isExhausted}
                            >
                              <Ionicons name="remove" size={18} color="white" />
                            </Pressable>

                            <Text style={styles.counterValue}>{currentQty}</Text>

                            <Pressable
                              style={[styles.counterBtn, (currentQty >= maxAvailable || isExhausted) && styles.counterBtnDisabled]}
                              onPress={() => handleQuantityChange(ticket.idTicket, 1, maxAvailable)}
                              disabled={currentQty >= maxAvailable || isExhausted}
                            >
                              <Ionicons name="add" size={18} color="white" />
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}

                    <View style={styles.summaryBox}>
                      <Text style={styles.summaryText}>
                        Total a procesar ahora: <Text style={styles.bold}>{getTotalSelectedCount()}</Text> entrada(s)
                      </Text>
                    </View>
                  </>
                )}
              </ScrollView>

              <View style={styles.buttonRow}>
                <Pressable
                  style={[
                    styles.actionButton,
                    styles.approveButton,
                    getTotalSelectedCount() === 0 && styles.disabledButton,
                  ]}
                  onPress={() => handleOpenConfirmation("Aprobado")}
                  disabled={getTotalSelectedCount() === 0}
                >
                  <Text style={styles.buttonActionText}>Aprobar</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.actionButton,
                    styles.rejectButton,
                    getTotalSelectedCount() === 0 && styles.disabledButton,
                  ]}
                  onPress={() => handleOpenConfirmation("Rechazado")}
                  disabled={getTotalSelectedCount() === 0}
                >
                  <Text style={styles.buttonActionText}>Rechazar</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", backgroundColor: "#22242e", paddingVertical: 10 },
  centerText: { flex: 1, color: "white", textAlign: "center", marginTop: 40 },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 15,
  },
  welcomeSubtitle: { color: "#A0A0A0", fontSize: 13 },
  welcomeTitle: { color: "white", fontSize: 20, fontWeight: "bold" },
  logoutButton: { backgroundColor: "#F44336", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, flexDirection: "row", alignItems: "center" },
  logoutButtonText: { color: "white", fontWeight: "bold", fontSize: 12 },
  sectionTitle: { color: "white", fontSize: 14, fontWeight: "600", alignSelf: "flex-start", marginLeft: "5%", marginBottom: 8 },

  dropdownContainer: {
    width: "90%",
    marginBottom: 15,
  },
  dropdownSelector: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#333645",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#44485B",
  },
  dropdownSelectorText: {
    color: "white",
    fontSize: 15,
    fontWeight: "600",
    flex: 1,
  },
  dropdownPlaceholderText: {
    color: "#AAA",
    fontWeight: "normal",
  },
  dropdownModalContent: {
    backgroundColor: "#333645",
    borderRadius: 12,
    padding: 16,
    width: "85%",
    maxHeight: "50%",
    borderWidth: 1,
    borderColor: "#44485B",
  },
  dropdownModalTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 12,
    textAlign: "center",
  },
  dropdownOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#44485B",
  },
  dropdownOptionSelected: {
    backgroundColor: "#4CAF50",
    borderRadius: 6,
  },
  dropdownOptionText: {
    color: "#DDD",
    fontSize: 14,
  },
  dropdownOptionTextSelected: {
    color: "white",
    fontWeight: "bold",
  },

  placeholderBox: {
    backgroundColor: "#1A1B23",
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    borderWidth: 1,
    borderColor: "#333645",
    borderStyle: "dashed",
  },
  placeholderText: { color: "#888", textAlign: "center", fontSize: 14 },
  button: { width: "90%", backgroundColor: "transparent", padding: 10, borderRadius: 5, alignItems: "center", marginTop: 10, borderWidth: 1, borderColor: "white", flexDirection: "row", justifyContent: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  modalContent: { backgroundColor: "white", borderRadius: 12, padding: 20, width: "88%", maxHeight: "85%", alignItems: "center" },
  modalTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 14, textAlign: "center", color: "#22242e" },
  modalInfoText: { fontSize: 13, marginBottom: 4, textAlign: "left", width: "100%", color: "#333" },
  subtitle: { fontSize: 15, fontWeight: "bold", marginTop: 8, marginBottom: 10, color: "#22242e" },
  bold: { fontWeight: "bold", color: "#111" },
  boldText: { fontWeight: "bold", color: "#22242e" },
  divider: { height: 1, backgroundColor: "#E0E0E0", width: "100%", marginVertical: 8 },

  /* MODAL ESTILO ERROR / ADVERTENCIA CON VECTOR ICON */
  resultModalContent: { backgroundColor: "white", borderRadius: 12, padding: 20, width: "85%", alignItems: "center", borderWidth: 2 },
  resultModalAprobado: { borderColor: "#4CAF50" },
  resultModalRechazado: { borderColor: "#F44336" },
  resultModalAdvertencia: { borderColor: "#FFC107" },
  resultModalIcon: { marginBottom: 8 },
  resultModalText: { fontSize: 16, fontWeight: "bold", textAlign: "center", marginBottom: 12, color: "#22242e" },
  resultModalButton: { backgroundColor: "#22242e", paddingVertical: 10, paddingHorizontal: 24, borderRadius: 6, marginTop: 14 },
  resultModalButtonText: { color: "white", fontWeight: "bold" },

  sectionSubtitleText: { fontSize: 13, fontWeight: "bold", color: "#22242e" },
  historyCard: {
    backgroundColor: "#F8F9FA",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  historyCardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  historyUserText: { fontSize: 11, fontWeight: "bold", color: "#2D3748" },
  historyTimeText: { fontSize: 11, color: "#718096" },
  historyTotalText: { fontSize: 11, color: "#4A5568", marginBottom: 2 },
  historyDetailText: { fontSize: 10, color: "#718096", marginLeft: 4 },
  emptyHistoryText: { fontSize: 11, color: "#718096", textAlign: "center", marginVertical: 6 },

  ticketCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: 10,
    backgroundColor: "#F8F9FA",
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E9ECEF",
  },
  ticketCardDisabled: {
    backgroundColor: "#F1F1F1",
    opacity: 0.7,
  },
  ticketInfoCol: { flex: 1 },
  ticketType: { fontSize: 15, fontWeight: "700", color: "#22242e" },
  ticketSubtitle: { fontSize: 12, color: "#6C757D", marginTop: 2 },
  ticketUsedText: { fontSize: 11, color: "#D9534F", marginTop: 1, fontWeight: "500" },
  counterRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#EAECEE", borderRadius: 6, padding: 2 },
  counterBtn: { width: 32, height: 32, backgroundColor: "#22242e", borderRadius: 4, justifyContent: "center", alignItems: "center" },
  counterBtnDisabled: { backgroundColor: "#BDC3C7" },
  counterValue: { width: 32, textAlign: "center", fontSize: 15, fontWeight: "bold", color: "#22242e" },
  summaryBox: { width: "100%", backgroundColor: "#E8F4FD", padding: 10, borderRadius: 6, marginTop: 6, marginBottom: 10, alignItems: "center" },
  summaryText: { color: "#1976D2", fontSize: 13, fontWeight: "600" },

  buttonRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 10 },
  actionButton: { flex: 1, paddingVertical: 12, borderRadius: 6, alignItems: "center", marginHorizontal: 4 },
  approveButton: { backgroundColor: "#4CAF50" },
  rejectButton: { backgroundColor: "#F44336" },
  disabledButton: { backgroundColor: "#A5D6A7", opacity: 0.6 },
  confirmCancelButton: { backgroundColor: "#757575" },
  buttonActionText: { color: "white", fontWeight: "bold", fontSize: 15 },
  confirmModalContent: { backgroundColor: "white", borderRadius: 12, padding: 20, width: 300, alignItems: "center" },
  confirmTitle: { fontSize: 17, fontWeight: "bold", marginBottom: 10, color: "#22242e" },
  confirmMessage: { fontSize: 14, textAlign: "center", marginBottom: 20, color: "#555" },
});

export default Home;