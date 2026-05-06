import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
// Firebase config loaded from environment or runtime injection
// Set window.__FIREBASE_CONFIG before loading this module, or update values below.
const firebaseConfig = window.__FIREBASE_CONFIG || {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
function formatForFirestore(data) {
    // Generate UUID if not exists in audit block
    const uuidStr = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    const eval_id = data._audit ? data._audit.evaluation_id : 'EVAL-' + uuidStr.split('-')[0].toUpperCase();
    
    // Fallbacks for tender/bidder names
    const tenderName = document.getElementById('tenderFileName')?.innerText?.replace('✓ ', '') || "Unknown Tender Document";
    const bidderName = document.getElementById('bidderFileName')?.innerText?.replace('✓ ', '') || "Unknown Bidder Submission";
    
    // Summary counts
    const evals = data.evaluation || [];
    const passed = evals.filter(e => e.result === 'PASS').length;
    const failed = evals.filter(e => e.result === 'FAIL').length;
    const review_required = evals.filter(e => e.result === 'REVIEW').length;
    
    let final_verdict = "ELIGIBLE";
    if (failed > 0) final_verdict = "NOT_ELIGIBLE";
    else if (review_required > 0) final_verdict = "REVIEW_REQUIRED";
    
    const criteria_results = evals.map(e => {
        let confidence = e.confidence || "MEDIUM";
        let verdict = e.result;
        if (verdict === "REVIEW") verdict = "REVIEW_REQUIRED"; // mapping to strict schema
        
        const cr = {
            criterion_id: e.criteria_id || e.criterion_id || "UNKNOWN",
            criterion_name: e.criteria_name || "",
            category: (e.category || "compliance").toLowerCase(),
            required_value: e.required_value || "",
            extracted_value: e.evidence_found || e.extracted_value || "",
            normalized_value: String(e.extracted_value || ""),
            verdict: verdict,
            confidence: confidence.toUpperCase(),
            gfr_reference: "GFR 2017 Rule 173", // generic fallback
            source: {
                page: 1, 
                raw_snippet: String(e.reason || "").substring(0, 200)
            }
        };
        return cr;
    });
    
    // Attempt to pull real page and snippet from evidence
    const evidence = data.evidence || [];
    criteria_results.forEach(cr => {
        const ev = evidence.find(e => e.criterion_id === cr.criterion_id);
        if (ev && ev.source) {
            cr.source.page = ev.source.page || 1;
            cr.source.raw_snippet = String(ev.source.raw_snippet || cr.source.raw_snippet).substring(0, 200);
            cr.normalized_value = String(ev.normalized_value || ev.extracted_value || "");
        }
    });

    return {
        evaluation_id: eval_id,
        timestamp: new Date().toISOString(),
        tender: {
            name: tenderName,
            authority: "CRPF",
            reference_no: "REF-" + eval_id
        },
        bidder: {
            name: bidderName,
            gstin: "UNKNOWN",
            pan: "UNKNOWN"
        },
        summary: {
            total_criteria: evals.length,
            passed: passed,
            failed: failed,
            review_required: review_required,
            final_verdict: final_verdict
        },
        criteria_results: criteria_results,
        verification: (data.verification || []).map(v => ({
            type: v.identifier_type || "UNKNOWN",
            value: v.identifier || "",
            status: v.status === "FORMAT_VALID" ? "VALID" : (v.status === "INVALID_FORMAT" ? "INVALID" : "NOT_FOUND"),
            details: v.details || ""
        })),
        vigilance: (data.issues || []).map(i => ({
            type: i.issue_type || "OTHER",
            severity: i.severity || "MEDIUM",
            description: String(i.reason || "").substring(0, 200)
        })),
        audit: {
            hash_sha256: data._audit ? data._audit.sha256_hash : "pending",
            model_version: "InferX v2.0"
        }
    };
}

window.saveToFirestore = async function(pipelineData) {
    if (!pipelineData || pipelineData.status !== 'success') return;
    
    console.log("[Firebase] Formatting data for Firestore...");
    try {
        const payload = formatForFirestore(pipelineData);
        
        let imagesToUpload = [];
        if (pipelineData.extraction_view) {
            const tenderImages = pipelineData.extraction_view.tender?.images || [];
            const bidderImages = pipelineData.extraction_view.bidder?.images || [];
            imagesToUpload = [...tenderImages, ...bidderImages];
        }
        
        if (imagesToUpload.length > 0) {
            console.log(`[Firebase] Uploading ${imagesToUpload.length} extracted images to Storage...`);
            if (window.showToast) window.showToast(`📤 Uploading ${imagesToUpload.length} extracted OCR images...`);
            
            const uploadedImages = await uploadImagesToStorage(imagesToUpload, payload.evaluation_id);
            payload.extracted_images = uploadedImages;
        }
        
        console.log("[Firebase] Payload ready:", payload);
        
        const docRef = await addDoc(collection(db, "evaluations"), payload);
        console.log("[Firebase] Document written with ID: ", docRef.id);
        
        if (window.showToast) {
            window.showToast("✅ Evaluation results securely saved to Firestore Audit Log.");
        }
    } catch (e) {
        console.error("[Firebase] Error adding document: ", e);
        if (window.showToast) {
            window.showToast("⚠️ Failed to save results to Firestore.");
        }
    }
}

async function uploadImagesToStorage(imagesArray, evalId) {
    const uploadedUrls = [];
    for (const img of imagesArray) {
        if (!img.image_url) continue;
        try {
            // Fetch local image generated by backend
            const response = await fetch(img.image_url);
            const blob = await response.blob();
            
            const filename = img.image_url.split('/').pop() || img.image_ref || 'image.png';
            const storageRef = ref(storage, `evaluations/${evalId}/${filename}`);
            
            await uploadBytes(storageRef, blob);
            const downloadUrl = await getDownloadURL(storageRef);
            
            uploadedUrls.push({
                original_ref: img.image_ref,
                storage_url: downloadUrl,
                page: img.page || 1,
                width: img.width,
                height: img.height
            });
        } catch (e) {
            console.error(`[Firebase] Failed to upload image ${img.image_url}:`, e);
        }
    }
    return uploadedUrls;
}

window.fetchHistory = async function() {
    try {
        const q = query(collection(db, "evaluations"), orderBy("timestamp", "desc"));
        const querySnapshot = await getDocs(q);
        const history = [];
        querySnapshot.forEach((doc) => {
            history.push({ id: doc.id, ...doc.data() });
        });
        return history;
    } catch (e) {
        console.error("[Firebase] Error fetching history:", e);
        if (window.showToast) {
            window.showToast("⚠️ Failed to load past extractions from Firestore. Check your Database Rules!");
        }
        return [];
    }
}
